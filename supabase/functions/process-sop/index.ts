import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SopProcessRequest {
  sopId: string;
  storagePath: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const qdrantUrl = Deno.env.get('QDRANT_URL')!;
    const qdrantApiKey = Deno.env.get('QDRANT_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { sopId, storagePath } = await req.json() as SopProcessRequest;

    console.log(`Processing SOP ${sopId} from ${storagePath}`);

    // Download PDF from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('sop_documents')
      .download(storagePath);

    if (downloadError) {
      throw new Error(`Failed to download SOP: ${downloadError.message}`);
    }

    // Convert blob to base64 for text extraction (simplified approach)
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // For demo: Extract basic text (in production, use proper PDF parser)
    const text = new TextDecoder().decode(uint8Array);
    
    // Sanitize and clean text
    const cleanedText = text
      .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable chars
      .replace(/\s+/g, ' ')
      .trim();

    // Chunk the text (simple approach: split by characters with overlap)
    const chunks: string[] = [];
    const chunkSize = 3000;
    const overlap = 300;
    
    for (let i = 0; i < cleanedText.length; i += chunkSize - overlap) {
      const chunk = cleanedText.substring(i, i + chunkSize);
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    console.log(`Created ${chunks.length} chunks`);

    // Generate embeddings using Lovable AI (Gemini)
    const embeddings: number[][] = [];
    
    for (const chunk of chunks) {
      const embedResponse = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: chunk,
        }),
      });

      if (!embedResponse.ok) {
        throw new Error(`Embedding failed: ${await embedResponse.text()}`);
      }

      const embedData = await embedResponse.json();
      embeddings.push(embedData.data[0].embedding);
    }

    console.log(`Generated ${embeddings.length} embeddings`);

    // Store in Qdrant
    const collectionName = 'sop_chunks';
    
    // Ensure collection exists
    const collectionCheck = await fetch(`${qdrantUrl}/collections/${collectionName}`, {
      headers: { 'api-key': qdrantApiKey },
    });

    if (collectionCheck.status === 404) {
      // Create collection
      await fetch(`${qdrantUrl}/collections/${collectionName}`, {
        method: 'PUT',
        headers: {
          'api-key': qdrantApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors: {
            size: embeddings[0].length,
            distance: 'Cosine',
          },
        }),
      });
      console.log('Created Qdrant collection');
    }

    // Store points in Qdrant and chunk metadata in Supabase
    const points = chunks.map((chunk, index) => {
      const pointId = `${sopId}_${index}`;
      return {
        id: pointId,
        vector: embeddings[index],
        payload: {
          sop_id: sopId,
          chunk_index: index,
          content: chunk.substring(0, 500), // Store preview
        },
      };
    });

    const upsertResponse = await fetch(`${qdrantUrl}/collections/${collectionName}/points`, {
      method: 'PUT',
      headers: {
        'api-key': qdrantApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ points }),
    });

    if (!upsertResponse.ok) {
      throw new Error(`Qdrant upsert failed: ${await upsertResponse.text()}`);
    }

    console.log('Stored points in Qdrant');

    // Store chunk metadata in Supabase
    const chunkRecords = chunks.map((chunk, index) => ({
      sop_id: sopId,
      chunk_index: index,
      content: chunk,
      qdrant_point_id: `${sopId}_${index}`,
      token_count: Math.ceil(chunk.length / 4), // Rough estimate
    }));

    const { error: chunkError } = await supabase
      .from('sop_chunks')
      .insert(chunkRecords);

    if (chunkError) {
      throw new Error(`Failed to store chunks: ${chunkError.message}`);
    }

    // Update SOP status to indexed
    const { error: updateError } = await supabase
      .from('sop_documents')
      .update({
        status: 'indexed',
        page_count: 1, // Simplified for demo
        content: cleanedText.substring(0, 10000), // Store sample
      })
      .eq('id', sopId);

    if (updateError) {
      throw new Error(`Failed to update SOP status: ${updateError.message}`);
    }

    console.log(`Successfully processed SOP ${sopId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sopId,
        chunksCreated: chunks.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing SOP:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});