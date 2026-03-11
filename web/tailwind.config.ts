import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#9566F2',
          50: '#F3EEFE',
          100: '#E8DDFB',
          500: '#9566F2',
          600: '#7C4FE0',
          700: '#6C3FD1',
          900: '#0A0A0F',
        },
        'accent-blue': {
          DEFAULT: '#1F74EC',
          500: '#1F74EC',
          600: '#125CCA',
          light: '#ADCFFF',
          bg: '#EEF4FE',
        },
        surface: {
          DEFAULT: '#1A1A2E',
          light: '#FFFFFF',
          secondary: '#22223A',
          'light-secondary': '#F4F5F7',
        },
        sidebar: '#0E0E1A',
        glass: {
          border: 'rgba(255,255,255,0.06)',
          'border-light': 'rgba(0,0,0,0.08)',
        },
        success: { DEFAULT: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
        warning: { DEFAULT: '#F9AA3C', bg: 'rgba(249,170,60,0.1)' },
        danger: { DEFAULT: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
        muted: { DEFAULT: '#A0A0B8', dark: '#6B6B80', light: '#BCC5D0' },
      },
      fontFamily: {
        heading: ['"Libre Franklin"', 'system-ui', 'sans-serif'],
        body: ['Mulish', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'heading-xl': ['2rem', { lineHeight: '2.5rem', fontWeight: '700' }],
        'heading-lg': ['1.375rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        'heading-md': ['1.25rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        'heading-sm': ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        'body-lg': ['1rem', { lineHeight: '1.5rem' }],
        'body-md': ['0.875rem', { lineHeight: '1.25rem' }],
        'body-sm': ['0.75rem', { lineHeight: '1rem' }],
        'label': ['0.8125rem', { lineHeight: '1rem', fontWeight: '500' }],
      },
      borderRadius: {
        card: '0.875rem',
        button: '0.625rem',
        input: '0.625rem',
        badge: '9999px',
      },
      backdropBlur: {
        glass: '8px',
      },
      boxShadow: {
        glass: '0 0 0 1px rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.15)',
        'glass-light': '0 0 0 1px rgba(0,0,0,0.08)',
        'card-hover': '0 4px 16px rgba(149,102,242,0.08)',
      },
      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
        'slide-in-left': 'slideInLeft 0.2s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideInLeft: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
