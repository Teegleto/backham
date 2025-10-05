/**
 * Use CommonJS export so PostCSS and Vercel can correctly load the configuration in a Node environment.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
