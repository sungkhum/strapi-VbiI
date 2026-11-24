'use strict';

module.exports = {
  routes: [
    {
      // Called by the site's tracked-link redirect. Strapi's own auth applies: only an API token
      // with full access (or this action granted) can count a click.
      method: 'POST',
      path: '/analytics/link-clicks',
      handler: 'link-clicks.record',
    },
  ],
};
