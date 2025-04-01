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
        `SELECT COUNT(*) FROM "${tableName}" WHERE ${queryConditions}`,
        searchParams
      );
      const total = parseInt(countResult.rows[0].count);
      
      // Execute the search query with pagination
      const results = await knex.raw(
        `SELECT * FROM "${tableName}" WHERE ${queryConditions} LIMIT ? OFFSET ?`,
        [...searchParams, pageSize, start]
      );
      
      // Get the entity service to properly format the response
      const { entity } = strapi.entityService;
      
      // Format results exactly like Strapi v5
      return {
        data: await Promise.all(
          results.rows.map(async (item) => {
            // Convert snake_case back to camelCase for attributes
            const attributes = {};
            Object.entries(item).forEach(([key, value]) => {
              if (key !== 'id') {
                // Convert snake_case to camelCase
                const camelKey = key.replace(/_([a-z])/g, (match, p1) => p1.toUpperCase());
                attributes[camelKey] = value;
              }
            });
            
            // Add publishedAt, createdAt, updatedAt that Strapi normally includes
            if (item.published_at) attributes.publishedAt = item.published_at;
            if (item.created_at) attributes.createdAt = item.created_at;
            if (item.updated_at) attributes.updatedAt = item.updated_at;
            
            return {
              id: item.id,
              documentId: item.document_id || item.id.toString(), // Strapi v5 uses documentId
              attributes
            };
          })
        ),
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