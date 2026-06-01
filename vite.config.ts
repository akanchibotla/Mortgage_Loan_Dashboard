import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from <user>.github.io/Mortgage_Loan_Dashboard/.
// Override at build time via VITE_BASE_PATH if you fork to a different repo name
// or use a custom domain.
const base = process.env.VITE_BASE_PATH ?? '/Mortgage_Loan_Dashboard/'

export default defineConfig({
  plugins: [react()],
  base,
})
