module.exports = [
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
            "dl.airtable.com",
            "cambodianchristianresourcesmedia .s3.ap-southeast-1.amazonaws.com", // change here
          ],
          "media-src": [
            "'self'",
            "data:",
            "blob:",
            "dl.airtable.com",
            "cambodianchristianresourcesmedia .s3.ap-southeast-1.amazonaws.com", // change here
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
