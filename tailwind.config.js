/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8FA',
        surface: '#FFFFFF',
        line: '#E5E7EB',
        ink: {
          DEFAULT: '#111827',
          muted: '#667085',
          faint: '#98A2B3',
        },
        brand: {
          DEFAULT: '#147D64',
          50: '#EEF7F4',
          100: '#D9EEE7',
          200: '#B3DED1',
          500: '#147D64',
          600: '#0F6653',
          700: '#0C5243',
        },
        success: '#15803D',
        warning: '#D97706',
        danger: '#DC2626',
        info: '#2563EB',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.04)',
        dropdown: '0 8px 24px -6px rgba(16, 24, 40, 0.14)',
      },
      borderRadius: {
        card: '8px',
      },
    },
  },
  plugins: [],
}
