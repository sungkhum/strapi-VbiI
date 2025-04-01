'use strict';

module.exports = {
  async khmerSearch(ctx) {
    try {
      // Get search query from URL parameters
      const { search } = ctx.query;
      
      if (!search) {
        return { data: [] };
      }
      
      // Get database connection
      const knex = strapi.db.connection;
      
      // Use the collectionName from your schema
      const tableName = 'resources';
      
      // Search only in KhmerTitle and KhmerDescription fields
      const searchFields = ['khmer_title', 'khmer_description']; 
      
      // Build query conditions using the normalize_khmer_search function
      const queryConditions = searchFields.map(field => 
        `normalize_khmer_search("${field}") ILIKE normalize_khmer_search(?)`
      ).join(' OR ');
      
      // Create array of search parameters (one for each field)
      const searchParams = searchFields.map(() => `%${search}%`);
      
      console.log('Query:', `SELECT * FROM "${tableName}" WHERE ${queryConditions}`);
      console.log('Params:', searchParams);
      
      // Execute the raw SQL query
      const results = await knex.raw(
        `SELECT * FROM "${tableName}" WHERE ${queryConditions}`,
        searchParams
      );
      
      // Format results to match Strapi's expected response format
      return {
        data: results.rows.map(item => ({
          id: item.id,
          attributes: Object.fromEntries(
            Object.entries(item).filter(([key]) => key !== 'id')
          )
        }))
      };
    } catch (error) {
      console.error('Khmer search error:', error);
      ctx.throw(500, 'Error performing Khmer search');
    }
  }
};