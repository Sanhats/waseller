/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          active: "var(--color-primary-active)",
          light: "var(--color-primary-light)",
          "ultra-light": "var(--color-primary-ultra-light)"
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
          muted: "var(--color-secondary-muted)"
        },
        growth: {
          DEFAULT: "var(--color-growth-base)",
          hover: "var(--color-growth-hover)",
          strong: "var(--color-growth-strong)",
          soft: "var(--color-growth-soft)"
        },
        success: {
          DEFAULT: "var(--color-success)",
          bg: "var(--color-success-bg)"
        },
        info: {
          DEFAULT: "var(--color-info)",
          bg: "var(--color-info-bg)"
        },
        chat: {
          incoming: "var(--color-chat-incoming-bg)",
          outgoing: "var(--color-chat-outgoing-bg)",
          active: "var(--color-chat-row-active-bg)",
          "active-border": "var(--color-chat-row-active-border)",
          new: "var(--color-chat-new-indicator)",
          meta: "var(--color-chat-meta)"
        },
        surface: "var(--color-surface)",
        border: {
          DEFAULT: "var(--color-border)"
        },
        muted: "var(--color-muted)",
        error: {
          DEFAULT: "var(--color-error)",
          bg: "var(--color-error-bg)"
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          bg: "var(--color-warning-bg)"
        },
        disabled: {
          DEFAULT: "var(--color-disabled)",
          bg: "var(--color-disabled-bg)"
        }
      },
      backgroundColor: {
        canvas: "var(--color-bg)"
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)"
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        tooltip: "var(--shadow-tooltip)"
      },
      spacing: {
        18: "4.5rem"
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        tooltip: "var(--duration-tooltip)"
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease-default)"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

module.exports = config;
