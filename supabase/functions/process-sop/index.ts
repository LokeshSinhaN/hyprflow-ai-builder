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
      .from('sop-documents')
      .download(storagePath);

    if (downloadError) {
      throw new Error(`Failed to download SOP: ${downloadError.message}`);
    }

    console.log('Extracting text from PDF using pdfjs-serverless...');
    const arrayBuffer = await fileData.arrayBuffer();
    
    // Use pdfjs-serverless which is Deno-compatible
    const { getDocument } = await import('https://esm.sh/pdfjs-serverless@0.3.2');
    const data = new Uint8Array(arrayBuffer);
    const doc = await getDocument(data).promise;
    
    let extractedText = '';
    
    // Extract text from all pages
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ');
      extractedText += pageText + '\n\n';
    }
    
    if (!extractedText || extractedText.length < 50) {
      throw new Error('Failed to extract meaningful text from PDF');
    }
    
    console.log(`Extracted ${extractedText.length} characters from ${doc.numPages} pages`);
    
    // Clean and normalize text
    const cleanedText = extractedText
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\n+/g, '\n') // Normalize newlines
      .trim();

    // Chunk the text with smaller chunks for better context retrieval
    const chunks: string[] = [];
    const chunkSize = 150;
    const overlap = 50;
    
    for (let i = 0; i < cleanedText.length; i += chunkSize - overlap) {
      const chunk = cleanedText.substring(i, i + chunkSize);
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    console.log(`Created ${chunks.length} chunks`);

    // Generate simple embeddings for demo (hash-based vectors)
    const embeddings: number[][] = [];
    
    for (const chunk of chunks) {
      // Create a simple 384-dimensional vector based on text characteristics
      const vector: number[] = [];
      for (let i = 0; i < 384; i++) {
        // Use character codes and position to create pseudo-embedding
        const val = chunk.split('').reduce((acc, char, idx) => {
          return acc + char.charCodeAt(0) * (idx + i + 1);
        }, 0);
        // Normalize to -1 to 1 range
        vector.push(Math.sin(val / 1000));
      }
      embeddings.push(vector);
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
      // Generate a proper UUID for Qdrant point ID
      const pointId = crypto.randomUUID();
      return {
        id: pointId,
        vector: embeddings[index],
        payload: {
          sop_id: sopId,
          chunk_index: index,
          content: chunk, // Store full chunk for context
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
      qdrant_point_id: points[index].id, // Use the same UUID as Qdrant
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
        page_count: 1,
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