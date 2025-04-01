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
      
      // Execute the search query with pagination
      const results = await knex.raw(
        `SELECT * FROM "${tableName}" 
         WHERE (${queryConditions}) ${publishedCondition}
         LIMIT ? OFFSET ?`,
        [...searchParams, pageSize, start]
      );
      
      // Format results exactly like Strapi's standard response
      return {
        data: results.rows.map(item => {
          // Create a flat object with PascalCase keys directly in data items
          const formattedItem = {
            id: item.id,
            documentId: item.document_id || '',
          };
          
          // Convert snake_case to PascalCase for main attributes
          // And directly add them to the top level (not in attributes)
          Object.entries(item).forEach(([key, value]) => {
            if (key !== 'id' && key !== 'document_id') {
              // Handle special cases for created_at, updated_at, published_at
              if (key === 'created_at') {
                formattedItem.createdAt = value;
              } else if (key === 'updated_at') {
                formattedItem.updatedAt = value;
              } else if (key === 'published_at') {
                formattedItem.publishedAt = value;
              } else {
                // Convert snake_case to PascalCase
                // First character uppercase followed by camelCase
                const pascalKey = key
                  .split('_')
                  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                  .join('');
                formattedItem[pascalKey] = value;
              }
            }
          });
          
          // Filter out fields that don't appear in the regular response
          const fieldsToExclude = ['createdById', 'updatedById', 'locale'];
          fieldsToExclude.forEach(field => {
            delete formattedItem[field];
          });
          
          return formattedItem;
        }),
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