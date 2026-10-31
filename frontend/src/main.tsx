import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/classic/theme.css'
import '@fullcalendar/react/themes/classic/palette.css'
import './style.css'
import './workspaces.css'
import './minimal.css'
import './space.css'
import './work-board.css'
import './contrast.css'

createRoot(document.getElementById('root')!).render(<App />)
