import { test, expect, type Page, type Locator } from './fixtures'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
async function setup(page: Page, documentFirst = false) {
  await page.addInitScript(() => {
    localStorage.setItem('pdm-chat-open', 'false')
    localStorage.setItem('pdm-theme', 'light')
  })
  await page.goto('/#space')
  await expect(page.getByRole('heading', { name: 'Các môn học', exact: true })).toBeVisible()
  const work = await (
    await page.request.post('/api/v1/tasks', { data: { title: 'Tài liệu có thể chỉnh sửa' } })
  ).json()
  const docs: any[] = []
  const formats = documentFirst ? ['docx', 'pdf'] : ['pdf', 'docx']
  for (const ext of formats) {
    const upload = await page.request.post('/api/v1/knowledge/upload', {
      multipart: {
        work_kind: 'tasks',
        work_id: work.id,
        file: {
          name: 'board-reader.' + ext,
          mimeType: 'application/octet-stream',
          buffer: readFileSync(
            'e2e/fixtures/' + (ext === 'docx' ? 'board-editable.docx' : 'board-reader.pdf'),
          ),
        },
      },
    })
    docs.push(await upload.json())
  }
  const pdf = docs[formats.indexOf('pdf')]
  const docx = docs[formats.indexOf('docx')]
  await page.request.patch('/api/v1/canvas/work:tasks:' + work.id, {
    data: {
      nodes: {
        ['document:' + pdf.id]: { x: 0, y: 0 },
        ['document:' + docx.id]: { x: 650, y: 0 },
      },
      sizes: {
        ['document:' + pdf.id]: { width: 600, height: 750 },
        ['document:' + docx.id]: { width: 650, height: 750 },
      },
      hidden: ['steps'],
      camera: { x: 20, y: 20, zoom: 1 },
    },
  })
  await page.goto('/#workspace/tasks/' + work.id)
  return {
    pdf: page.locator('[data-board-card="document:' + pdf.id + '"]'),
    docx: page.locator('[data-board-card="document:' + docx.id + '"]'),
    doc: docx,
    work,
  }
}

const nativeEditor = (card: Locator) => card.frameLocator('iframe[title="Chỉnh sửa DOCX"]')
const nativeCanvas = (card: Locator) =>
  nativeEditor(card).getByRole('textbox', { name: 'Nội dung tài liệu Word', exact: true })

async function readyWriter(card: Locator) {
  await expect(card.locator('iframe[title="Chỉnh sửa DOCX"]')).toBeVisible()
  await expect(card.getByText('Đang mở trình chỉnh sửa DOCX…', { exact: true })).toHaveCount(0, {
    timeout: 60000,
  })
  await expect(nativeCanvas(card)).toBeVisible({ timeout: 60000 })
  await expect(nativeEditor(card).getByRole('button', { name: 'In đậm', exact: true })).toBeEnabled(
    { timeout: 60000 },
  )
  await expect(nativeCanvas(card)).toHaveAttribute('aria-readonly', 'false')
  await expect(card.getByRole('alert')).toHaveCount(0)
}
async function openWriter(card: Locator) {
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await readyWriter(card)
}
// Stress the ordered native keyboard channel with zero-delay key events.
async function typeWord(page: Page, text: string) {
  await page.keyboard.type(text)
}
async function insertAtStart(page: Page, card: Locator, text: string) {
  await nativeCanvas(card).focus()
  await page.keyboard.press('Control+Home')
  await typeWord(page, text)
  await expect(card.locator('.docx-save-state')).toHaveText('Chưa lưu')
}

// Assert the DOCX produced by the native editor, rather than canvas pixels or
// a second renderer. Python's standard library reads the actual Word package.
function inspectWord(bytes: Buffer) {
  const script = `import sys,io,json,zipfile,hashlib
from xml.etree import ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
 root=E.fromstring(z.read('word/document.xml'))
 texts=lambda node: ''.join(t.text or '' for t in node.findall('.//w:t',ns))
 bold=[]
 for run in root.findall('.//w:r',ns):
  b=run.find('w:rPr/w:b',ns)
  if b is not None and b.get('{'+ns['w']+'}val','true') not in ('0','false','off'): bold.append(texts(run))
 headers=[texts(E.fromstring(z.read(name))) for name in z.namelist() if name.startswith('word/header') and name.endswith('.xml')]
 media=sorted(hashlib.sha256(z.read(name)).hexdigest() for name in z.namelist() if name.startswith('word/media/'))
 attr=lambda node,path,key: node.find(path,ns).get('{'+ns['w']+'}'+key) if node.find(path,ns) is not None else None
 formats=[{'text':texts(run),'size':attr(run,'w:rPr/w:sz','val'),'font':attr(run,'w:rPr/w:rFonts','ascii')} for run in root.findall('.//w:r',ns)]
 print(json.dumps({'text':texts(root),'bold':bold,'tables':len(root.findall('.//w:tbl',ns)),'cells':[texts(cell) for cell in root.findall('.//w:tc',ns)],'headers':headers,'pictures':len(root.findall('.//w:drawing',ns)),'media':media,'formats':formats}))`
  return JSON.parse(
    execFileSync('python3', ['-c', script], {
      input: bytes,
      maxBuffer: 4 * 1024 * 1024,
    }).toString(),
  ) as {
    text: string
    bold: string[]
    tables: number
    cells: string[]
    headers: string[]
    pictures: number
    media: string[]
    formats: { text: string; size: string | null; font: string | null }[]
  }
}
async function savedWord(page: Page, id: string) {
  const response = await page.request.get('/api/v1/knowledge/documents/' + id + '/file')
  expect(response.ok()).toBeTruthy()
  return inspectWord(await response.body())
}
async function saveWriter(card: Locator) {
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(card.locator('.docx-save-state')).toHaveText('Đã lưu', { timeout: 60000 })
  await expect(card.getByRole('alert')).toHaveCount(0)
}
async function compose(card: Locator, text: string) {
  await nativeCanvas(card).focus()
  const cdp = await card.page().context().newCDPSession(card.page())
  try {
    // Real Blink editing/composition pipeline, not dispatchEvent stubs. This
    // exercises the browser half of IME; physical Windows UniKey is separate.
    await cdp.send('Input.imeSetComposition', {
      text: text.slice(0, 2),
      selectionStart: 2,
      selectionEnd: 2,
    })
    // Provisional text is painted by Writer while composing, not only on Space.
    await expect(card.locator('.docx-save-state')).toHaveText('Chưa lưu')
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
    await cdp.send('Input.insertText', { text })
  } finally {
    await cdp.detach()
  }
}

test('PDF has selectable aligned text at document and board zoom levels', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { pdf } = await setup(page)
  const select = async () => {
    await pdf.locator('.pdf-scroll').evaluate((el) => (el.scrollTop = 0))
    const span = pdf
      .locator('[data-pdf-page="1"] .pdf-text-layer span')
      .filter({ hasText: 'Board PDF page 1' })
      .first()
    await expect(span).toBeVisible()
    const box = (await span.boundingBox())!
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString()))
      .toContain('Board PDF page')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('Board PDF page')
  }
  await select()
  await page.screenshot({ path: 'test-results/pdf-copy-text.png' })
  const before = await page.locator('.wb-world').getAttribute('style')
  await pdf.getByRole('button', { name: 'Phóng to tài liệu', exact: true }).click()
  await expect(pdf.locator('[data-pdf-page="1"] .pdf-text-layer')).toHaveCSS(
    '--total-scale-factor',
    '1.25',
  )
  expect(await page.locator('.wb-world').getAttribute('style')).toBe(before)
  await select()
  const board = (await page.locator('.work-board').boundingBox())!
  await page.mouse.move(board.x + 5, board.y + 5)
  await page.mouse.wheel(0, -400)
  await expect(page.locator('.wb-world')).toHaveCSS('transform', /matrix\(2,/)
  await select()
  await page.screenshot({ path: 'test-results/pdf-copy-text-zoom.png' })
})
test('DOCX opens Writer inside its card and switches preview and edit without replacing the editor', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await expect(docx.locator('.docx-save')).toBeDisabled()
  await insertAtStart(page, docx, 'previewbaselineuniquetoken ')
  expect(
    await nativeCanvas(docx).evaluate(
      (canvas) => canvas instanceof HTMLCanvasElement && canvas.width > 100 && canvas.height > 100,
    ),
  ).toBeTruthy()
  await nativeCanvas(docx).evaluate((canvas) =>
    canvas.setAttribute('data-session-marker', 'same-writer'),
  )
  await docx.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(nativeCanvas(docx)).toHaveAttribute('aria-readonly', 'true')
  await expect(nativeEditor(docx).getByRole('toolbar')).toBeHidden()
  await nativeCanvas(docx).focus()
  await typeWord(page, '_previewmustnotedit')
  await expect(docx.locator('iframe[title="Nội dung DOCX"]')).toHaveCount(0)
  await docx.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await expect(nativeCanvas(docx)).toHaveAttribute('aria-readonly', 'false')
  await expect(nativeCanvas(docx)).toHaveAttribute('data-session-marker', 'same-writer')
  await saveWriter(docx)
  const actual = await savedWord(page, doc.id)
  expect(actual.text.toLowerCase()).toContain('previewbaselineuniquetoken')
  expect(actual.text).not.toContain('_previewmustnotedit')
  await page.screenshot({ path: 'test-results/docx-editor-first.png' })
  expect(errors).toEqual([])
})

test('reindexing an open DOCX preserves its iframe, unsaved edits and conflict protection', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc, work } = await setup(page, true)
  const contextPath = '/api/v1/workspaces/tasks/' + work.id
  await expect
    .poll(
      async () => {
        const detail = await (await page.request.get(contextPath)).json()
        return detail.documents.every((item: any) => item.status === 'ready')
      },
      { timeout: 15000 },
    )
    .toBe(true)
  await openWriter(docx)
  await insertAtStart(page, docx, 'unsavedreindexregression ')
  await nativeCanvas(docx).evaluate((canvas) =>
    canvas.setAttribute('data-reindex-marker', 'original-writer'),
  )
  const before = await (await page.request.get(contextPath)).json()
  const endpoint = '/api/v1/knowledge/documents/' + doc.id + '/docx'
  const original = await page.request.get(endpoint)
  const replacement = readFileSync('e2e/fixtures/board-reader.docx')
  const saved = await page.request.put(endpoint, {
    multipart: {
      revision: original.headers()['x-document-revision'],
      file: {
        name: 'board-reader.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: replacement,
      },
    },
  })
  expect(saved.ok()).toBeTruthy()
  const after = await (await page.request.get(contextPath)).json()
  expect(after.documents.map((item: any) => item.id)).toEqual(
    before.documents.map((item: any) => item.id),
  )
  // Wait for the actual workspace poll that previously moved the iframe's card.
  await page.waitForResponse((response) => new URL(response.url()).pathname === contextPath)
  await expect(nativeCanvas(docx)).toHaveAttribute('data-reindex-marker', 'original-writer')
  await expect(docx.locator('.docx-save-state')).toHaveText('Chưa lưu')
  await docx.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(docx.getByRole('alert')).toContainText('File đã thay đổi ở nơi khác')
  expect(await (await page.request.get(endpoint)).body()).toEqual(replacement)
})

test('Writer Retry replaces a failed engine and opens the document in a fresh iframe', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx } = await setup(page)
  let attempts = 0
  await page.route('**/api/v1/office/runtime', (route) => {
    attempts++
    return attempts === 1 ? route.fulfill({ json: { available: false } }) : route.continue()
  })
  await docx.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await expect(docx.getByRole('alert')).toContainText('Bộ LibreOffice Writer chưa sẵn sàng', {
    timeout: 30000,
  })
  await docx
    .locator('iframe[title="Chỉnh sửa DOCX"]')
    .evaluate((frame) => frame.setAttribute('data-failed-engine', 'old'))
  await docx.getByRole('button', { name: 'Thử mở lại', exact: true }).click()
  await readyWriter(docx)
  await expect(docx.locator('iframe[title="Chỉnh sửa DOCX"]')).not.toHaveAttribute(
    'data-failed-engine',
    'old',
  )
  expect(attempts).toBe(2)
})

test('DOCX keeps a local draft when hidden, saves native Word bytes and reopens them', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await insertAtStart(page, docx, 'docxediteduniquetoken ')
  await docx.getByRole('button', { name: 'Ẩn thẻ board-reader.docx', exact: true }).click()
  await expect(docx).toHaveCount(0)
  await page.getByRole('button', { name: /Hiện thẻ đã ẩn/ }).click()
  await readyWriter(docx)
  await expect(docx.locator('.docx-save-state')).toHaveText('Chưa lưu')
  await docx.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(nativeCanvas(docx)).toHaveAttribute('aria-readonly', 'true')
  await docx.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await nativeCanvas(docx).focus()
  await page.keyboard.press('Control+s')
  await expect(docx.locator('.docx-save-state')).toHaveText('Đã lưu', { timeout: 60000 })
  const bytes = await (
    await page.request.get('/api/v1/knowledge/documents/' + doc.id + '/file')
  ).body()
  writeFileSync('test-results/docx-edited.docx', bytes)
  const actual = inspectWord(bytes)
  expect(actual.text.toLowerCase()).toContain('docxediteduniquetoken')
  expect(actual.text).toContain('Table survives DOCX edit')
  expect(actual.headers.join(' ')).toContain('Header must survive')
  expect(actual.pictures).toBeGreaterThan(0)
  expect(actual.media).toEqual(inspectWord(readFileSync('e2e/fixtures/board-editable.docx')).media)
  await page.reload()
  await expect(
    docx.frameLocator('iframe[title="Nội dung DOCX"]').getByText(/docxediteduniquetoken/i),
  ).toBeVisible({ timeout: 30000 })
  await page.screenshot({ path: 'test-results/docx-edited-preview.png' })
})

test('DOCX keeps edits on failed Save and resolves a changed original without overwriting it', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối', exact: true }).click()
  await openWriter(docx)
  await insertAtStart(page, docx, 'localdraftuniqueword ')
  let fail = true
  await page.route('**/api/v1/knowledge/documents/' + doc.id + '/docx', (route) =>
    route.request().method() === 'PUT' && fail
      ? route.fulfill({ status: 503, json: { detail: 'Chưa lưu được DOCX thử nghiệm' } })
      : route.continue(),
  )
  await docx.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(docx.getByRole('alert')).toContainText('Chưa lưu được DOCX thử nghiệm', {
    timeout: 60000,
  })
  await expect(nativeCanvas(docx)).toBeVisible()
  expect((await savedWord(page, doc.id)).text.toLowerCase()).not.toContain('localdraftuniqueword')
  fail = false
  const current = await page.request.get('/api/v1/knowledge/documents/' + doc.id + '/docx')
  const external = await page.request.put('/api/v1/knowledge/documents/' + doc.id + '/docx', {
    multipart: {
      revision: current.headers()['x-document-revision'],
      file: {
        name: 'other.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: readFileSync('e2e/fixtures/board-reader.docx'),
      },
    },
  })
  expect(external.ok()).toBeTruthy()
  await docx.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(docx.getByRole('alert')).toContainText('File đã thay đổi ở nơi khác', {
    timeout: 60000,
  })
  const downloading = page.waitForEvent('download')
  await docx.getByRole('button', { name: 'Tải bản đang sửa', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('board-reader.docx')
  expect(inspectWord(readFileSync((await download.path())!)).text.toLowerCase()).toContain(
    'localdraftuniqueword',
  )
  expect((await savedWord(page, doc.id)).text.toLowerCase()).not.toContain('localdraftuniqueword')
  await page.screenshot({ path: 'test-results/docx-conflict-dark.png' })
  await docx.getByRole('button', { name: 'Bỏ bản sửa, tải bản mới', exact: true }).click()
  await readyWriter(docx)
  await expect(docx.locator('.docx-save-state')).toHaveText('Đã lưu')
  await expect(docx.getByRole('alert')).toHaveCount(0)
  await insertAtStart(page, docx, 'recoveredwriteruniquetoken ')
  await saveWriter(docx)
  const recovered = await savedWord(page, doc.id)
  expect(recovered.text.toLowerCase()).toContain('recoveredwriteruniquetoken')
  expect(recovered.text.toLowerCase()).not.toContain('localdraftuniqueword')
})

test('Writer formats text, inserts a native table and preserves existing Word content', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await nativeCanvas(docx).focus()
  await page.keyboard.press('Control+Home')
  const bold = nativeEditor(docx).getByRole('button', { name: 'In đậm', exact: true })
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await expect(
    nativeEditor(docx).getByRole('textbox', { name: 'Nhập văn bản tài liệu Word', exact: true }),
  ).toBeFocused()
  await typeWord(page, 'formattedbolduniquetoken ')
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await expect(
    nativeEditor(docx).getByRole('textbox', { name: 'Nhập văn bản tài liệu Word', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await nativeEditor(docx).getByRole('button', { name: 'Chèn bảng 3 × 3', exact: true }).click()
  await expect(
    nativeEditor(docx).getByRole('textbox', { name: 'Nhập văn bản tài liệu Word', exact: true }),
  ).toBeFocused()
  await typeWord(page, 'firstnewtablecell')
  await page.keyboard.press('Tab')
  await typeWord(page, 'secondnewtablecell')
  await saveWriter(docx)
  const actual = await savedWord(page, doc.id)
  expect(actual.bold.join('').toLowerCase()).toContain('formattedbolduniquetoken')
  expect(actual.tables).toBe(2)
  expect(actual.cells.map((cell) => cell.toLowerCase())).toContain('firstnewtablecell')
  expect(actual.cells.map((cell) => cell.toLowerCase())).toContain('secondnewtablecell')
  expect(actual.cells).toContain('Table survives DOCX edit')
  expect(actual.headers.join(' ')).toContain('Header must survive')
  expect(actual.pictures).toBeGreaterThan(0)
  expect(actual.media).toEqual(inspectWord(readFileSync('e2e/fixtures/board-editable.docx')).media)
})

test('Writer commits Vietnamese composition once and supports native Undo', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await nativeCanvas(docx).focus()
  await page.keyboard.press('Control+Home')
  // Chromium composition verifies the real browser input and commit path.
  const vietnamese = 'Ghi chú tiếng Việt: quản lý công việc. '
  await compose(docx, vietnamese)
  await expect(docx.locator('.docx-save-state')).toHaveText('Chưa lưu')
  await compose(docx, 'hủy-thử-nghiệm')
  await nativeEditor(docx).getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  await saveWriter(docx)
  const actual = await savedWord(page, doc.id)
  expect(actual.text.split(vietnamese)).toHaveLength(2)
  expect(actual.text).not.toContain('hủy-thử-nghiệm')
})

test('Writer accepts UniKey-style replacements, cancellation and saving an active composition', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await nativeCanvas(docx).focus()
  await page.keyboard.press('Control+Home')
  // UniKey can erase a previous vowel and inject its Unicode replacement
  // instead of sending a compositionend for the entire syllable.
  await page.keyboard.type('tie')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('ế')
  await page.keyboard.type('ng Vie')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('ệ')
  await page.keyboard.type('t ')
  const input = nativeEditor(docx).getByRole('textbox', {
    name: 'Nhập văn bản tài liệu Word',
    exact: true,
  })
  // Replace surrounding text, including decomposed Unicode graphemes.
  await page.keyboard.insertText('a\u0306')
  await input.evaluate((element) => {
    const field = element as HTMLTextAreaElement
    field.setSelectionRange(field.value.length - 2, field.value.length)
  })
  await page.keyboard.insertText('ắ ')
  for (const symbol of ['😀', '👨‍👩‍👧‍👦']) {
    await page.keyboard.insertText(symbol)
    await page.keyboard.press('Backspace')
  }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', {
      text: 'không-được-lưu',
      selectionStart: 0,
      selectionEnd: 13,
    })
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await cdp.send('Input.imeSetComposition', {
      text: 'quản lý công việc',
      selectionStart: 17,
      selectionEnd: 17,
    })
    // Blur/Save must flush the composition, even before the idle snapshot.
    await saveWriter(docx)
  } finally {
    await cdp.detach()
  }
  const actual = await savedWord(page, doc.id)
  expect(actual.text).toContain('tiếng Việt ắ quản lý công việc')
  expect(actual.text).not.toContain('không-được-lưu')
  expect(actual.text).not.toContain('tie')
  await docx.getByRole('button', { name: 'Xem trước', exact: true }).click()
  await expect(nativeCanvas(docx)).toHaveAttribute('aria-readonly', 'true')
  await nativeCanvas(docx).focus()
  await page.keyboard.insertText('cấm-thay-đổi')
  await docx.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click()
  await insertAtStart(page, docx, 'mở-lại ')
  await saveWriter(docx)
  expect((await savedWord(page, doc.id)).text).not.toContain('cấm-thay-đổi')
})

test('Writer font and size controls change the exported Word formatting', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await insertAtStart(page, docx, 'fontsizetoken')
  await page.keyboard.press('Control+Shift+ArrowLeft')
  await nativeEditor(docx).getByLabel('Phông chữ', { exact: true }).selectOption('Liberation Mono')
  await nativeEditor(docx).getByLabel('Cỡ chữ', { exact: true }).selectOption('24')
  await saveWriter(docx)
  const actual = await savedWord(page, doc.id)
  const formatted = actual.formats.find((run) => run.text.toLowerCase().includes('fontsizetoken'))
  expect(formatted).toMatchObject({ size: '48', font: 'Liberation Mono' })
})

test('Writer keyboard selection survives card resizing and board zoom', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await insertAtStart(page, docx, 'zoomselectiontoken ')
  await page.getByRole('button', { name: 'Thu nhỏ board', exact: true }).click()
  await expect(page.locator('.wb-world')).toHaveCSS('transform', /matrix\(0\.83333/)
  const resize = docx.getByRole('button', {
    name: 'Đổi kích thước thẻ board-reader.docx',
    exact: true,
  })
  const width = await docx.evaluate((card) => (card as HTMLElement).offsetWidth)
  await resize.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await expect
    .poll(() => docx.evaluate((card) => (card as HTMLElement).offsetWidth))
    .toBe(width + 40)
  // Return to the document as a user does after operating the board controls.
  // Focusing an already-active element inside an inactive iframe is a DOM
  // no-op in Chromium; a pointer click activates the browsing context too.
  await nativeCanvas(docx).click({ position: { x: 160, y: 230 } })
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+Shift+ArrowRight')
  await typeWord(page, 'replacedzoomtoken ')
  await saveWriter(docx)
  const actual = await savedWord(page, doc.id)
  expect(actual.text.toLowerCase()).toContain('replacedzoomtoken')
  expect(actual.text.toLowerCase()).not.toContain('zoomselectiontoken')
  await expect(docx.locator('iframe[title="Chỉnh sửa DOCX"]')).toHaveCount(1)
})

test('Writer keeps edits made during Save and rebases their recovered draft', async ({ page }) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 1798, height: 1025 })
  const { docx, doc } = await setup(page)
  await openWriter(docx)
  await insertAtStart(page, docx, 'beforesaveuniquetoken ')
  let release!: () => void, started!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const requested = new Promise<void>((resolve) => (started = resolve))
  let first = true
  await page.route('**/api/v1/knowledge/documents/' + doc.id + '/docx', async (route) => {
    if (route.request().method() === 'PUT' && first) {
      first = false
      started()
      await blocked
    }
    await route.continue()
  })
  try {
    await docx.getByRole('button', { name: 'Lưu', exact: true }).click()
    await requested
    await nativeCanvas(docx).click({ position: { x: 160, y: 230 } })
    await page.keyboard.press('Control+Home')
    await typeWord(page, 'duringsaveuniquetoken ')
    await expect(docx.locator('.docx-save-state')).toHaveText('Đang lưu…')
    await docx.getByRole('button', { name: 'Ẩn thẻ board-reader.docx', exact: true }).click()
    // Closing waits for the commit and draft rebase; it must not unmount an
    // editor whose pending Save still owns the previous document revision.
    await expect(docx).toBeVisible()
  } finally {
    release()
  }
  await expect(docx).toHaveCount(0, { timeout: 60000 })
  const firstSave = await savedWord(page, doc.id)
  expect(firstSave.text.toLowerCase()).toContain('beforesaveuniquetoken')
  expect(firstSave.text.toLowerCase()).not.toContain('duringsaveuniquetoken')
  await page.getByRole('button', { name: /Hiện thẻ đã ẩn/ }).click()
  await readyWriter(docx)
  await expect(docx.locator('.docx-save-state')).toHaveText('Chưa lưu')
  await expect(docx.getByRole('alert')).toHaveCount(0)
  await saveWriter(docx)
  const finalSave = await savedWord(page, doc.id)
  expect(finalSave.text.toLowerCase()).toContain('beforesaveuniquetoken')
  expect(finalSave.text.toLowerCase()).toContain('duringsaveuniquetoken')
})

test('PDF selection follows rotated page geometry', async ({ page }) => {
  const { work } = await setup(page)
  const result = await page.request.post('/api/v1/knowledge/upload', {
    multipart: {
      work_kind: 'tasks',
      work_id: work.id,
      file: {
        name: 'rotated.pdf',
        mimeType: 'application/pdf',
        buffer: readFileSync('e2e/fixtures/board-reader-rotated.pdf'),
      },
    },
  })
  const doc = await result.json()
  await page.request.patch('/api/v1/canvas/work:tasks:' + work.id, {
    data: {
      nodes: { ['document:' + doc.id]: { x: 0, y: 0 } },
      sizes: { ['document:' + doc.id]: { width: 700, height: 700 } },
      camera: { x: 20, y: 20, zoom: 1 },
      hidden: ['steps'],
    },
  })
  await page.reload()
  const card = page.locator('[data-board-card="document:' + doc.id + '"]')
  for (const [pageNumber, rotation] of [
    [1, 90],
    [2, 180],
    [3, 270],
  ]) {
    if (pageNumber > 1) await card.getByLabel('Số trang').fill(String(pageNumber))
    const layer = card.locator('[data-pdf-page="' + pageNumber + '"] .pdf-text-layer')
    await expect(layer).toHaveAttribute('data-text-ready', 'true')
    await expect(layer).toHaveAttribute('data-main-rotation', String(rotation))
    const span = layer.locator('span').filter({ hasText: 'Board PDF page 1' }).first()
    await span.dblclick()
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString()))
      .toMatch(/Board|PDF|page|1/)
  }
})
