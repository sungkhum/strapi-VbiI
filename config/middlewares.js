module.exports = ({ env }) => [
  'strapi::logger',
  "strapi::errors",
  {
    name: "strapi::security",
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "https:"],
          "img-src": [
            "'self'",
            "data:",
            "blob:",
            `https://795b8014fa1b6617c4d7f3b040683260.r2.cloudflarestorage.com`,
          ],
          "media-src": [
            "'self'",
            "data:",
            "blob:",
            `https://795b8014fa1b6617c4d7f3b040683260.r2.cloudflarestorage.com`,
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
