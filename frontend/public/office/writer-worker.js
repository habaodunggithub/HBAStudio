/* SPDX-License-Identifier: MIT
 * HBA bridge to the unmodified LibreOffice UNO document model via ZetaJS.
 * Native model, undo manager and DOCX filters own every content operation.
 */
'use strict';
let zeta, css, desktop, context, toolkit, model, controller, loadId = '', version = 0;
let modifyListener, statusListeners = [], viewMode = 'edit';
let baseZoom = 0, logicalWidth = 0;
let compositionUndo = false;
function endComposition() {
  if (compositionUndo && model) model.getUndoManager().leaveUndoContext();
  compositionUndo = false;
}
// View notifications may arrive after the viewport call returns. Keep them
// separate until keyboard/toolbar/pointer input resumes document work.
let viewNotification = false;
const send = data => zeta.mainPort.postMessage({ loadId, version, ...data });
const property = (Name, Value) => new css.beans.PropertyValue({ Name, Value });
function dispatch(name, values = []) {
  return css.frame.DispatchHelper.create(context).executeDispatch(controller.getFrame(), '.uno:' + name, '', 0, values);
}
function fit() {
  controller.getViewSettings().setPropertyValue('ZoomType', new zeta.Any(zeta.type.short, css.view.DocumentZoomType.PAGE_WIDTH));
}
function viewport(message) {
  viewNotification = true;
  const scale = Math.max(.1, Number(message.scale) || 1), width = Number(message.width) / scale;
  const view = controller.getViewSettings();
  if (!baseZoom || message.fit || Math.abs(width - logicalWidth) > 2) {
    fit(); toolkit.processEventsToIdle();
    baseZoom = view.getPropertyValue('ZoomValue') / scale;
    logicalWidth = width;
  }
  // The iframe uses physical pixels for sharp rendering and fixed-size tools.
  // Paper follows the world scale, preserving its logical size inside the card.
  const zoom = Math.max(20, Math.min(600, Math.round(baseZoom * scale)));
  if (view.getPropertyValue('ZoomType') !== css.view.DocumentZoomType.BY_VALUE)
    view.setPropertyValue('ZoomType', new zeta.Any(zeta.type.short, css.view.DocumentZoomType.BY_VALUE));
  if (view.getPropertyValue('ZoomValue') !== zoom)
    view.setPropertyValue('ZoomValue', new zeta.Any(zeta.type.short, zoom));
  toolkit.processEventsToIdle();
  return zoom;
}
function close() {
  if (!model) return;
  endComposition();
  try { model.removeModifyListener(modifyListener); } catch {}
  for (const [dispatcher, listener, url] of statusListeners) try { dispatcher.removeStatusListener(listener, url); } catch {}
  statusListeners = [];
  model.setModified(false); model.close(true); model = null;
}
function formatting() {
  for (const name of ['Bold', 'Italic', 'Underline', 'DefaultBullet', 'DefaultNumbering', 'CharFontName', 'FontHeight', 'ParaStyle']) {
    const parsed = { val: new css.util.URL({ Complete: '.uno:' + name }) };
    css.util.URLTransformer.create(context).parseStrict(parsed);
    const url = parsed.val, dispatcher = controller.queryDispatch(url, '_self', 0);
    if (!dispatcher) continue;
    const listener = zeta.unoObject([css.frame.XStatusListener], {
      disposing() {}, statusChanged(event) {
        let value = zeta.fromAny(event.State);
        if (name === 'CharFontName') value = value?.Name;
        else if (name === 'FontHeight') value = value?.Height;
        if (['string', 'number', 'boolean'].includes(typeof value)) send({ cmd: 'format', name, value });
      },
    });
    dispatcher.addStatusListener(listener, url); statusListeners.push([dispatcher, listener, url]);
  }
}
function mode(value) {
  // EditDoc reloads the backing file in Writer. A viewer mode is an input
  // policy instead: preserve this exact in-memory model and its undo history.
  viewMode = value === 'preview' ? 'preview' : 'edit';
}
function load() {
  close(); version = 0; baseZoom = 0; logicalWidth = 0;
  model = desktop.loadComponentFromURL('file:///tmp/hba-input.docx', '_default', 0, [
    property('MacroExecutionMode', 0), property('UpdateDocMode', 0), property('ReadOnly', false),
  ]);
  if (!model) throw Error('Không mở được tài liệu Word.');
  controller = model.getCurrentController();
  const frame = controller.getFrame(); frame.getContainerWindow().FullScreen = true;
  const layout = frame.LayoutManager;
  for (const element of layout.getElements()) try { layout.hideElement(element.getResourceURL()); } catch {}
  layout.hideElement('private:resource/menubar/menubar'); dispatch('Sidebar');
  layout.hideElement('private:resource/statusbar/statusbar');
  layout.setVisible(false);
  const view = controller.getViewSettings();
  for (const name of ['ShowRulers', 'ShowHoriRuler', 'ShowVertRuler', 'ShowNonprintingCharacters']) try { view.setPropertyValue(name, false); } catch {}
  modifyListener = zeta.unoObject([css.util.XModifyListener], {
    disposing() {}, modified() {
      // Undo may restore the initial content and clear isModified(). It still
      // needs a new version so recovery cannot resurrect the undone text.
      if (!model || viewNotification) return;
      version++; send({ cmd: 'change' });
    },
  });
  model.addModifyListener(modifyListener); formatting();
  controller.getViewCursor().gotoRange(model.getText().getStart(), false);
}
function command(name, args) {
  viewNotification = false;
  if (viewMode !== 'edit' || model.isReadonly()) return;
  if (name === 'insert-text') {
    const text = String(args.text || '');
    if (text.length > 2 * 1024 * 1024) throw Error('Đoạn văn bản quá dài.');
    dispatch('InsertText', [property('Text', text)]);
  } else if (name === 'StyleApply') dispatch(name, [property('Style', String(args.style)), property('FamilyName', 'ParagraphStyles')]);
  else if (name === 'CharFontName') dispatch(name, [property('CharFontName.FamilyName', String(args.font))]);
  else if (name === 'FontHeight') dispatch(name, [property('FontHeight.Height', new zeta.Any(zeta.type.float, Math.max(6, Math.min(96, Number(args.size) || 12))))]);
  else if (name === 'InsertTable') dispatch(name, [property('Rows', new zeta.Any(zeta.type.short, 3)), property('Columns', new zeta.Any(zeta.type.short, 3))]);
  else if (['Undo', 'Redo', 'Bold', 'Italic', 'Underline', 'DefaultBullet', 'DefaultNumbering', 'LeftPara', 'CenterPara', 'RightPara'].includes(name)) dispatch(name);
  else throw Error('Công cụ chưa được hỗ trợ.');
}
function key(message) {
  const names = { ArrowLeft:'LEFT', ArrowRight:'RIGHT', ArrowUp:'UP', ArrowDown:'DOWN', Home:'HOME', End:'END', PageUp:'PAGEUP', PageDown:'PAGEDOWN', Enter:'RETURN', Tab:'TAB', Backspace:'BACKSPACE', Delete:'DELETE', Escape:'ESCAPE', Insert:'INSERT', Space:'SPACE' };
  const name = names[message.key] || names[message.code] || (/^Key[A-Z]$/.test(message.code) ? message.code.slice(3) : /^Digit[0-9]$/.test(message.code) ? 'NUM' + message.code.slice(5) : /^F\d+$/.test(message.code) ? message.code : null);
  const code = name ? css.awt.Key[name] : 0;
  const modifiers = (message.shift ? css.awt.KeyModifier.SHIFT : 0) | (message.ctrl ? css.awt.KeyModifier.MOD1 : 0) | (message.alt ? css.awt.KeyModifier.MOD2 : 0);
  const event = new css.awt.KeyEvent({ Source: controller.getFrame().getComponentWindow(), KeyCode: code || 0,
    KeyChar: message.key.length === 1 && !message.ctrl && !message.alt ? message.key : '\0', KeyFunc: 0, Modifiers: modifiers });
  toolkit.keyPress(event); toolkit.keyRelease(event);
}
function erase(direction, count) {
  const name = direction === 'Backspace' ? 'SwBackspace' : 'Delete';
  while (count > 0) {
    const cursor = controller.getViewCursor();
    if (count === 1 || !cursor.isCollapsed()) {
      dispatch(name); count--; continue;
    }
    // Select only within this paragraph, then let Writer perform the delete.
    // Paragraph/list/cell boundaries still use its ordinary native command.
    const paragraph = cursor.getText().createTextCursorByRange(cursor);
    if (direction === 'Backspace') paragraph.gotoStartOfParagraph(true);
    else paragraph.gotoEndOfParagraph(true);
    const text = paragraph.getString();
    const available = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
    const take = Math.min(count, available);
    if (take) dispatch(direction === 'Backspace' ? 'GoLeft' : 'GoRight', [
      property('Count', new zeta.Any(zeta.type.short, take)), property('Select', true),
    ]);
    dispatch(name);
    count -= take || 1;
  }
}
function keys(events) {
  viewNotification = events.every(event =>
    /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown|Escape)$/.test(event.key) ||
    (event.ctrl && ['a', 'c'].includes(event.key.toLowerCase())));
  // Text and deletion bursts use Writer commands, keeping its formatting,
  // collapsed caret and undo semantics. Avoid a cross-thread toolkit roundtrip
  // and full document repaint for every character in a pending burst.
  model.lockControllers();
  try {
    for (let i = 0; i < events.length;) {
      const event = events[i];
      if (event.composition) {
        if (event.composition === 'end') endComposition();
        else if (viewMode === 'edit' && !compositionUndo) {
          model.getUndoManager().enterUndoContext('Nhập bằng bộ gõ'); compositionUndo = true;
        }
        i++;
      } else if (viewMode === 'edit' && typeof event.text === 'string') {
        // Browser/OS IMEs can replace already committed surrounding text (e.g.
        // UniKey backspace + accented vowel). Keep each replacement atomic for
        // native Undo. Composition updates share one outer Undo context.
        const remove = String(event.removeText || '');
        let text = event.text; i++;
        while (i < events.length && typeof events[i].text === 'string' && !events[i].removeText && events[i].composing === event.composing) text += events[i++].text;
        if (text.length > 2 * 1024 * 1024) throw Error('Đoạn văn bản quá dài.');
        const undo = model.getUndoManager();
        if (event.composing && !compositionUndo) { undo.enterUndoContext('Nhập bằng bộ gõ'); compositionUndo = true; }
        if (remove) undo.enterUndoContext('Nhập văn bản');
        try {
          if (remove) {
            // Writer Backspace removes combining marks separately. Select the
            // exact old browser suffix instead, including NFD and surrogate
            // pairs, before replacing it through the native delete command.
            const caret = controller.getViewCursor();
            let range = caret.getText().createTextCursorByRange(caret.getEnd());
            range.goLeft(Math.min(32767, [...remove].length), true);
            if (range.getString() !== remove) {
              range = caret.getText().createTextCursorByRange(caret.getEnd());
              for (let n = 0; n < remove.length && range.getString().length < remove.length; n++)
                if (!range.goLeft(1, true)) break;
            }
            if (range.getString() !== remove) throw Error('Vị trí nhập đã thay đổi. Hãy bấm lại vào đoạn văn rồi tiếp tục gõ.');
            caret.gotoRange(range.getStart(), false); caret.gotoRange(range.getEnd(), true);
            dispatch('SwBackspace');
          }
          if (text) dispatch('InsertText', [property('Text', text)]);
        } finally { if (remove) undo.leaveUndoContext(); }
      } else if (viewMode === 'edit' && !event.ctrl && !event.alt && event.key.length === 1) {
        let text = '';
        do { text += events[i++].key; }
        while (i < events.length && !events[i].ctrl && !events[i].alt && events[i].key.length === 1);
        dispatch('InsertText', [property('Text', text)]);
      } else if (viewMode === 'edit' && !event.ctrl && !event.alt && !event.shift && ['Backspace', 'Delete'].includes(event.key)) {
        let count = 0;
        do { count++; i++; }
        while (i < events.length && !events[i].ctrl && !events[i].alt && !events[i].shift && events[i].key === event.key);
        erase(event.key, count);
      } else {
        key(event); i++;
        toolkit.processEventsToIdle();
      }
    }
  } finally { model.unlockControllers(); }
  toolkit.processEventsToIdle();
}
function messageError(error, operation) {
  if (error instanceof Error) return error.message;
  try { console.warn('Writer native exception', operation, getExceptionMessage(error)); } catch {}
  try {
    const detail = zeta.fromAny(zeta.catchUnoException(error));
    console.warn('Writer UNO failure', operation, detail?.ErrCode || detail?.ErrorCode || 'unknown');
  } catch {}
  return operation === 'export'
    ? 'Writer chưa xuất được DOCX. Hãy kiểm tra ảnh hoặc nội dung nhúng trong tài liệu; bản gốc vẫn được giữ.'
    : 'Writer chưa xử lý được tài liệu. Hãy thử mở lại; bản gốc vẫn được giữ.';
}
Module.zetajs.then(api => {
  zeta = api; css = zeta.uno.com.sun.star;
  context = zeta.getUnoComponentContext(); desktop = css.frame.Desktop.create(context); toolkit = css.awt.Toolkit.create(context);
  zeta.mainPort.onmessage = event => {
    const message = event.data;
    if (message.cmd !== 'load' && message.loadId !== loadId) return;
    if (message.cmd === 'interaction') viewNotification = false;
    try {
      let zoom;
      if (model && message.cmd !== 'keys') toolkit.processEventsToIdle();
      if (message.cmd === 'load') { loadId = message.loadId; load(); }
      else if (!model) throw Error('Tài liệu chưa sẵn sàng.');
      else if (message.cmd === 'keys') {
        // Keyboard bursts share one native event-loop drain/repaint. Awaiting
        // a full repaint per key creates seconds of lag on multi-page files.
        if (!Array.isArray(message.events) || message.events.length > 256) throw Error('Nhóm phím không hợp lệ.');
        keys(message.events);
      }
      else if (message.cmd === 'export') {
        endComposition();
        // Export a copy; explicit HBA Save commits it with revision checking.
        // Native modification state, source URL and undo history remain intact.
        model.storeToURL('file:///tmp/hba-output.docx', [property('FilterName', 'Office Open XML Text'), property('Overwrite', true)]);
      } else if (message.cmd === 'mode') mode(message.value);
      else if (message.cmd === 'interaction') { /* Native pointer gesture, not a view refresh. */ }
      else if (message.cmd === 'checkpoint') { /* Pending input was drained above; result carries its version. */ }
      else if (message.cmd === 'command') command(message.name, message.args || {});
      else if (message.cmd === 'viewport') zoom = viewport(message);
      else throw Error('Yêu cầu không hợp lệ.');
      send({ cmd: 'result', request: message.request, zoom });
    } catch (error) { send({ cmd: 'error', request: message.request, message: messageError(error, message.cmd) }); }
  };
  send({ cmd: 'runtime-ready' });
});
