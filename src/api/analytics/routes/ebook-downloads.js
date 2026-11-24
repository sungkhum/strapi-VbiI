'use strict';

module.exports = {
  routes: [
    {
      // Called by the site's eBook redirect. Strapi's own auth applies: only an API token
      // with full access (or this action granted) can count a download.
      method: 'POST',
      path: '/analytics/ebook-downloads',
      handler: 'ebook-downloads.record',
    },
    {
      method: 'GET',
      path: '/analytics/ebook-downloads',
      handler: 'ebook-downloads.export',
      config: {
        // Not public: the controller requires INSIGHTS_EXPORT_TOKEN. Strapi's own auth is
        // skipped so that no role or API token in the admin can open it.
        auth: false,
      },
    },
  ],
};
