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
          600: '#7A4AD9',
          700: '#4E1BD9',
          900: '#12081E',
        },
        'accent-blue': {
          DEFAULT: '#1F74EC',
          500: '#1F74EC',
          600: '#125CCA',
          light: '#ADCFFF',
          bg: '#EEF4FE',
        },
        surface: {
          DEFAULT: '#22182D',
          light: '#FFFFFF',
          secondary: '#2F233C',
          'light-secondary': '#F4F5F7',
        },
        sidebar: '#270E5F',
        glass: {
          border: 'rgba(255,255,255,0.08)',
          'border-light': 'rgba(0,0,0,0.08)',
        },
        success: { DEFAULT: '#0EB01D', bg: '#DDFCE0' },
        warning: { DEFAULT: '#F9AA3C', bg: '#FEEFDB' },
        danger: { DEFAULT: '#EF4444' },
        muted: { DEFAULT: '#959CA6', dark: '#5C6574', light: '#BCC5D0' },
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
        card: '0.75rem',
        button: '0.5rem',
        input: '0.5rem',
        badge: '9999px',
      },
      backdropBlur: {
        glass: '5.4px',
      },
      boxShadow: {
        glass: '0 0 0 1px rgba(255,255,255,0.08)',
        'glass-light': '0 0 0 1px rgba(0,0,0,0.08)',
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
