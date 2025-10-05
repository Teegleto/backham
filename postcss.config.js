// Use the Tailwind v4 PostCSS plugin package (not "tailwindcss").
// Keep CommonJS export so Node/Vercel can load it.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {}
  }
};
