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
      
      // First attempt: remove zero-width spaces for entire phrase search
      const searchNoZWS = search.replace(/\u200B/g, '');
      console.log('Search term without zero-width spaces:', searchNoZWS);
      
      const phraseSqlQuery = `
        SELECT id, document_id FROM "${tableName}"
        WHERE (
          normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
          OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?)
        )
        AND published_at IS NOT NULL
        LIMIT ? OFFSET ?
      `;
      
      // Execute the phrase search
      const phraseResults = await knex.raw(
        phraseSqlQuery,
        [`%${searchNoZWS}%`, `%${searchNoZWS}%`, pageSize, start]
      );
      
      let documentIds = phraseResults.rows.map(row => row.document_id);
      let total = 0;
      
      if (documentIds.length > 0) {
        console.log('Found results using phrase search:', documentIds.length);
        
        // Get total count for phrase search
        const countResult = await knex.raw(
          `SELECT COUNT(*) FROM "${tableName}" 
           WHERE (
             normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
             OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?)
           )
           AND published_at IS NOT NULL`,
          [`%${searchNoZWS}%`, `%${searchNoZWS}%`]
        );
        total = parseInt(countResult.rows[0].count);
      } else {
        // Second attempt: treat zero-width spaces as word separators and search for each word using LIKE
        console.log('No results with phrase search, trying word-by-word search treating zero-width spaces as separators');
        
        // Split the original search term by both regular spaces and zero-width spaces
        const searchTerms = search.split(/[\s\u200B]+/).filter(term => term.length > 0);
        console.log('Search terms after splitting:', searchTerms);
        
        if (searchTerms.length === 0) {
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
        
        // Build query conditions for each term using ? placeholders
        // Each term must appear in either the title or description (AND logic across terms)
        let queryConditions = searchTerms.map(() => {
          return `(normalize_khmer_search(khmer_title) ILIKE normalize_khmer_search(?)
                  OR normalize_khmer_search(khmer_description) ILIKE normalize_khmer_search(?))`;
        }).join(' AND ');
        
        // Create parameters array: one pair per term, wrapped in %
        let searchParams = [];
        searchTerms.forEach(term => {
          searchParams.push(`%${term}%`);
          searchParams.push(`%${term}%`);
        });
        
        // Append pagination parameters
        searchParams.push(pageSize);
        searchParams.push(start);
        
        // Build SQL query using ? placeholders
        const wordSqlQuery = `
          SELECT id, document_id FROM "${tableName}"
          WHERE ${queryConditions}
          AND published_at IS NOT NULL
          LIMIT ? OFFSET ?
        `;
        
        console.log('Word-by-word SQL Query:', wordSqlQuery);
        console.log('SQL Params:', searchParams);
        
        const wordResults = await knex.raw(wordSqlQuery, searchParams);
        documentIds = wordResults.rows.map(row => row.document_id);
        
        if (documentIds.length > 0) {
          // Remove pagination parameters for count query
          let countParams = searchParams.slice(0, -2);
          const countQuery = `
            SELECT COUNT(*) FROM "${tableName}" 
            WHERE ${queryConditions}
            AND published_at IS NOT NULL
          `;
          
          const countResult = await knex.raw(countQuery, countParams);
          total = parseInt(countResult.rows[0].count);
        }
      }
      
      // If no results from either search approach, return empty data
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
      
      // Helper function to sanitize user objects
      const sanitizeUser = (user) => {
        if (!user) return null;
        return {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname
        };
      };
      
      // Helper function to recursively sanitize all data
      const sanitizeData = (data) => {
        if (!data) return null;
        if (Array.isArray(data)) {
          return data.map(item => sanitizeData(item));
        }
        if (typeof data === 'object') {
          const result = {};
          for (const [key, value] of Object.entries(data)) {
            if (['password', 'resetPasswordToken', 'registrationToken', 'email'].includes(key)) {
              continue;
            }
            if (key === 'createdBy' || key === 'updatedBy') {
              result[key] = sanitizeUser(value);
              continue;
            }
            result[key] = sanitizeData(value);
          }
          return result;
        }
        return data;
      };
      
      // Sanitize and order the results to match the original documentIds order
      const sanitizedResults = sanitizeData(fullResults);
      const orderedResults = [];
      for (const docId of documentIds) {
        const matchingResource = sanitizedResults.find(r => r.documentId === docId);
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
