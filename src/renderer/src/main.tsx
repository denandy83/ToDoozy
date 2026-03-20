import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import QuickAddApp from './QuickAddApp'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const params = new URLSearchParams(window.location.search)
const isQuickAdd = params.get('window') === 'quickadd'

createRoot(rootElement).render(
  <StrictMode>
    {isQuickAdd ? <QuickAddApp /> : <App />}
  </StrictMode>
)
