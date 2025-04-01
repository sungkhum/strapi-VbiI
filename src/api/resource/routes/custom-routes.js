module.exports = {
    routes: [
      {
        method: 'GET',
        path: '/resources/khmer-search',
        handler: 'custom-search.khmerSearch',
        config: {
          auth: false, // Set to true if authentication is required
        },
      },
    ],
  };