/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: ['selector', '[data-theme="dark"]'],
    theme: {
        extend: {
            colors: {
                primary: "var(--accent-primary)",
                secondary: "var(--accent-hover)",
                surface: "var(--bg-elevated)",
                canvas: "var(--bg-primary)",
                ink: "var(--text-primary)",
                muted: "var(--text-muted)",
                border: "var(--border-color)",
                "bg-secondary": "var(--bg-secondary)",
                "bg-tertiary": "var(--bg-tertiary)",
                "text-secondary": "var(--text-secondary)",
                success: "var(--success-color)",
                warning: "var(--warning-color)",
                danger: "var(--danger-color)",
                info: "var(--info-color)",
            },
            fontFamily: {
                sans: ["'Plus Jakarta Sans'", "'Inter'", "system-ui", "-apple-system", "sans-serif"],
                display: ["'Plus Jakarta Sans'", "'Inter'", "system-ui", "-apple-system", "sans-serif"],
                mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
            },
            borderRadius: {
                DEFAULT: "10px",
                sm: "6px",
                md: "10px",
                lg: "14px",
                xl: "20px",
                full: "9999px",
            },
        },
    },
    plugins: [],
};
