# Third-party software and assets

The MIT license in `LICENSE` applies to this project's original code. Dependencies
and bundled assets retain their own licenses. Dependency versions are recorded in
`uv.lock` and `frontend/pnpm-lock.yaml`; their distributions contain their notices.

| Component | Use | License / notices |
| --- | --- | --- |
| Itim by Cadson Demak | Bundled UI font | [SIL Open Font License](frontend/public/fonts/OFL-Itim.txt) |
| PDF.js | PDF rendering, CMaps, fonts and WASM copied during frontend builds | [Apache-2.0 and bundled notices](https://github.com/mozilla/pdf.js/blob/master/LICENSE) |
| React | UI | [MIT](https://github.com/facebook/react/blob/main/LICENSE) |
| FullCalendar | Calendar UI | See the installed `@fullcalendar/react` package and its dependency notices |
| Lucide | Icons | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| docx-preview | Read-only DOCX preview | [Apache-2.0](https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE) |
| LibreOffice WebAssembly | Optional DOCX editing engine; downloaded separately | Upstream licenses and source URLs in [the pinned manifest](resources/office-runtime.json) |
| ZetaJS | Optional LibreOffice bridge; downloaded separately | Upstream MIT notice in [the pinned manifest](resources/office-runtime.json) |
| multilingual-e5-small | Optional semantic-search model; downloaded separately | [Model card and license](https://huggingface.co/intfloat/multilingual-e5-small) |

The Writer installer verifies all pinned bytes and records `runtime.json` and
`NOTICE.txt` beside the downloaded runtime. The runtime binaries and model weights
are not part of the source repository or Python wheel. If you redistribute those
binaries or a complete application bundle, include the upstream notices and follow
the corresponding source-availability requirements; this project's MIT license
does not replace them.

Frontend builds retain PDF.js's packaged CMap, standard-font and WASM license files
under `pdf-assets/`, and the package's main license under `licenses/pdfjs-LICENSE`.
They also collect the LICENSE/COPYING/NOTICE files of bundled dependency packages
in `licenses/dependencies.txt`, alongside the project license and these notices.
