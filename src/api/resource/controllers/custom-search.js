'use strict';

module.exports = {
  async khmerSearch(ctx) {
    try {
      // Get search query from URL parameters
      const { search } = ctx.query;
      
      if (!search) {
        return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
      }
      
      // Get database connection
      const knex = strapi.db.connection;
      
      // Use the collectionName from your schema
      const tableName = 'resources';
      
      // Get pagination params (same as Strapi's default)
      const page = parseInt(ctx.query.page) || 1;
      const pageSize = parseInt(ctx.query.pageSize) || 25;
      const start = (page - 1) * pageSize;
      
      // Check if we should include drafts (default: only published)
      const publishState = ctx.query.publicationState || 'published';
      let publishedCondition = '';
      
      if (publishState === 'published') {
        publishedCondition = 'AND published_at IS NOT NULL';
      } else if (publishState === 'draft') {
        publishedCondition = 'AND published_at IS NULL';
      }
      
      // Search only in KhmerTitle and KhmerDescription fields
      const searchFields = ['khmer_title', 'khmer_description']; 
      
      // Build query conditions using the normalize_khmer_search function
      const queryConditions = searchFields.map(field => 
        `normalize_khmer_search("${field}") ILIKE normalize_khmer_search(?)`
      ).join(' OR ');
      
      // Create array of search parameters (one for each field)
      const searchParams = searchFields.map(() => `%${search}%`);
      
      // Count total matching records
      const countResult = await knex.raw(
        `SELECT COUNT(*) FROM "${tableName}" 
         WHERE (${queryConditions}) ${publishedCondition}`,
        searchParams
      );
      const total = parseInt(countResult.rows[0].count);
      
      // Execute the search query with pagination to get IDs only
      const resultsQuery = await knex.raw(
        `SELECT id FROM "${tableName}" 
         WHERE (${queryConditions}) ${publishedCondition}
         LIMIT ? OFFSET ?`,
        [...searchParams, pageSize, start]
      );
      
      // Get the IDs from the raw query results
      const ids = resultsQuery.rows.map(row => row.id);
      
      // If no results, return empty data
      if (ids.length === 0) {
        return {
          data: [],
          meta: {
            pagination: {
              page,
              pageSize,
              pageCount: 0,
              total: 0
            }
          }
        };
      }
      
      // Use Strapi's entity service to fetch full data with populated relations
      const fullResults = await strapi.entityService.findMany('api::resource.resource', {
        filters: {
          id: {
            $in: ids
          }
        },
        populate: {
          FeaturedImage: true,
          eBook: true,
          type: true,
          authors: true,
          publishers: true,
          categories: true
        }
      });
      
      // Format results to match Strapi's standard response format
      // Keep PascalCase for field names to match your front-end expectations
      return {
        data: fullResults.map(item => ({
          id: item.id,
          documentId: item.documentId || '',
          EnglishTitle: item.EnglishTitle,
          KhmerTitle: item.KhmerTitle,
          EnglishDescription: item.EnglishDescription,
          KhmerDescription: item.KhmerDescription,
          slug: item.slug,
          PurchaseLink: item.PurchaseLink,
          AudioBookLink: item.AudioBookLink,
          PublishedDate: item.PublishedDate,
          IsFeatured: item.IsFeatured,
          FeaturedImage: item.FeaturedImage,
          eBook: item.eBook,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          publishedAt: item.publishedAt,
          VideoLink: item.VideoLink,
          ExternalLink: item.ExternalLink,
          eBookDownloads: item.eBookDownloads,
          AudioBookDownloads: item.AudioBookDownloads,
          VideoClicks: item.VideoClicks,
          ExternalLinkClicks: item.ExternalLinkClicks,
          PurchaseLinkClick: item.PurchaseLinkClick,
          VideoLessons: item.VideoLessons,
          VideoLessonsClicks: item.VideoLessonsClicks,
          // Include the populated relations
          type: item.type,
          authors: item.authors,
          publishers: item.publishers,
          categories: item.categories
        })),
        meta: {
          pagination: {
            page,
            pageSize,
            pageCount: Math.ceil(total / pageSize),
            total
          }
        }
      };
    } catch (error) {
      console.error('Khmer search error:', error);
      ctx.throw(500, 'Error performing Khmer search');
    }
  }
};