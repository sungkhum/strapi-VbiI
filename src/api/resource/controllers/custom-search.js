'use strict';

module.exports = {
  async khmerSearch(ctx) {
    try {
      // Get search query from URL parameters
      const { search } = ctx.query;
      
      if (!search) {
        return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
      }

      console.log('Searching for Khmer text:', search);
      
      // Get database connection
      const knex = strapi.db.connection;
      
      // Use the collectionName from your schema
      const tableName = 'resources';
      
      // Get pagination params (same as Strapi's default)
      const page = parseInt(ctx.query.page) || 1;
      const pageSize = parseInt(ctx.query.pageSize) || 25;
      const start = (page - 1) * pageSize;
      
      // Search query with normalize_khmer_search function
      const sqlQuery = `
        SELECT id, document_id FROM "${tableName}"
        WHERE (
          normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
          OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?)
        )
        AND published_at IS NOT NULL
        LIMIT ? OFFSET ?
      `;
      
      // Execute the search query to get both ID and documentId
      const results = await knex.raw(
        sqlQuery,
        [`%${search}%`, `%${search}%`, pageSize, start]
      );
      
      const documentIds = results.rows.map(row => row.document_id);
      console.log('Found resource documentIds:', documentIds);
      
      if (documentIds.length === 0) {
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
      
      // Count total matching records
      const countResult = await knex.raw(
        `SELECT COUNT(*) FROM "${tableName}" 
         WHERE (
           normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
           OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?)
         )
         AND published_at IS NOT NULL`,
        [`%${search}%`, `%${search}%`]
      );
      const total = parseInt(countResult.rows[0].count);
      
      // Use Strapi's entity service with documentId to get the complete data
      const fullResults = await strapi.entityService.findMany('api::resource.resource', {
        filters: {
          documentId: {
            $in: documentIds
          }
        },
        publicationState: 'published', // Explicitly request published items
        populate: '*'  // Populate all relationships
      });
      
      console.log('Fetched full resources:', fullResults.length);
      
      // In case there's any mismatch between SQL results and entity service results,
      // make sure we keep them in the original order
      const orderedResults = [];
      for (const docId of documentIds) {
        const matchingResource = fullResults.find(r => r.documentId === docId);
        if (matchingResource) {
          orderedResults.push(matchingResource);
        }
      }
      
      return {
        data: orderedResults,
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