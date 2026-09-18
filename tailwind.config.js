/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#2563eb',
        surface: '#ffffff',
        panel: '#f8fafc',
        edge: '#e2e8f0',
      },
    },
  },
  plugins: [],
};
