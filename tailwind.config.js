/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "primary": "var(--lcars-primary)",
                "secondary": "var(--lcars-secondary)",
                "background-light": "#f6f8f8",
                "background-dark": "var(--lcars-bg)",
            },
            fontFamily: {
                "display": ["Spline Sans", "sans-serif"]
            },
            borderRadius: {
                "DEFAULT": "1rem",
                "lg": "2rem",
                "xl": "3rem",
                "full": "9999px"
            },
            keyframes: {
                pan: {
                    '0%': { backgroundPosition: '0% 0%' },
                    '50%': { backgroundPosition: '100% 100%' },
                    '100%': { backgroundPosition: '0% 0%' },
                }
            },
            animation: {
                'pan-slow': 'pan 60s ease-in-out infinite',
            }
        },
    },
    plugins: [],
}
