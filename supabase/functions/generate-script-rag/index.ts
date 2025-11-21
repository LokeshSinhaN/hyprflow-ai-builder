import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  message: string;
  conversationId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, conversationId }: GenerateRequest = await req.json();
    console.log('Generating script for message:', message);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const qdrantUrl = Deno.env.get('QDRANT_URL')!;
    const qdrantApiKey = Deno.env.get('QDRANT_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user's SOPs
    const { data: conversation } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', conversationId)
      .single();

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const { data: sops } = await supabase
      .from('sop_documents')
      .select('id')
      .eq('user_id', conversation.user_id)
      .eq('status', 'indexed');

    // Retrieve ALL chunks from user's SOPs (no semantic search)
    let allChunks: string[] = [];
    
    if (sops && sops.length > 0) {
      console.log(`Retrieving ALL chunks from ${sops.length} SOPs...`);
      
      // Fetch ALL points from Qdrant that belong to user's SOPs
      const sopIds = sops.map(sop => sop.id);
      
      const scrollResponse = await fetch(`${qdrantUrl}/collections/sop_chunks/points/scroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': qdrantApiKey,
        },
        body: JSON.stringify({
          filter: sopIds.length === 1 
            ? {
                must: [
                  {
                    key: "sop_id",
                    match: { value: sopIds[0] }
                  }
                ]
              }
            : {
                should: sopIds.map(id => ({
                  key: "sop_id",
                  match: { value: id }
                }))
              },
          limit: 1000, // Adjust based on expected chunk count
          with_payload: true,
          with_vector: false, // Don't need vectors, just content
        }),
      });

      if (scrollResponse.ok) {
        const scrollResults = await scrollResponse.json();
        
        // Sort chunks by chunk_index to preserve original order
        const sortedPoints = scrollResults.result.points.sort((a: any, b: any) => {
          return a.payload.chunk_index - b.payload.chunk_index;
        });
        
        allChunks = sortedPoints.map((point: any) => point.payload.content);
        
        console.log(`Retrieved ${allChunks.length} chunks in original document order`);
      } else {
        console.error('Failed to retrieve chunks from Qdrant:', await scrollResponse.text());
      }
    }

    // Construct complete document context from ALL chunks
    const context = allChunks.length > 0
      ? `\n\n=== COMPLETE SOP DOCUMENT (ALL CHUNKS) ===\n${allChunks.join('\n')}\n=== END OF SOP DOCUMENT ===\n`
      : '';

    const systemPrompt = `You are an Automation Script Generator. Your ONLY source of truth is the SOP document chunks provided below.

=== BEHAVIORAL RULES ===

1. **DO NOT** perform semantic search, cosine similarity, ranking, or any retrieval algorithm.
2. **ASSUME** all provided chunks are already relevant and must be fully consumed.
3. **TREAT** all chunks as the authoritative requirement document.
4. **READ** and understand all chunks in full. These chunks contain:
   - Step-by-step procedures
   - Instructions and workflow logic
   - Conditions and business rules
   - UI element descriptions
   - Web automation requirements

5. **GENERATE** two complete, production-ready scripts upon request:
   - Python script (using Selenium WebDriver for browser automation)
   - Playwright script (JavaScript/TypeScript, preserving all logic and steps)

6. **FOLLOW** these script generation rules:
   - Use correct automation flow based on ALL chunks
   - Include ALL steps present in the chunks
   - Maintain accurate sequencing and branching
   - NO hallucination beyond provided requirements
   - Add proper error handling and logging
   - Include all necessary imports and setup

7. **FOR SCRIPT EDITING:** When user requests modifications:
   - Only modify what the user requests
   - Do NOT alter unrelated logic
   - Maintain consistency between steps and automation flow
   - Never re-hallucinate steps not in chunks unless explicitly requested

8. **IF INFORMATION IS MISSING:**
   - If chunks are missing: "The provided documents do not contain information for that. Please upload or provide the relevant steps."
   - If user asks something outside chunks: "The provided documents do not contain information for that. Please upload or provide the relevant steps."

=== OUTPUT FORMAT ===

You MUST return your response in this EXACT format:

=== PYTHON_SCRIPT ===
[Complete Python script using Selenium WebDriver]
=== END_PYTHON_SCRIPT ===

=== PLAYWRIGHT_SCRIPT ===
[Complete Node.js Playwright script]
=== END_PLAYWRIGHT_SCRIPT ===

${context ? '\n=== YOUR AUTHORITATIVE SOURCE ===\nThe complete SOP document is provided below. You MUST consume and use ALL of it.\n' : '\n=== NO SOP DOCUMENT PROVIDED ===\nNo SOP has been uploaded. Inform the user to upload an SOP first.\n'}`;

    const userPrompt = context 
      ? `User Request: ${message}\n\n${context}`
      : `User Request: ${message}\n\nNOTE: No SOP document is available. Please ask the user to upload an SOP first.`;

    console.log(`Calling Gemini 2.5 Pro with ALL ${allChunks.length} chunks (no filtering)...`);
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const generatedContent = aiData.choices[0].message.content;

    console.log('Script generation complete');

    return new Response(
      JSON.stringify({ 
        scripts: generatedContent,
        totalChunksUsed: allChunks.length,
        sopCount: sops?.length || 0,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in generate-script-rag:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
