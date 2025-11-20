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

// Simple hash-based embedding (MUST match process-sop exactly)
function generateSimpleEmbedding(text: string): number[] {
  const vector: number[] = [];
  for (let i = 0; i < 384; i++) {
    // Use character codes and position to create pseudo-embedding
    const val = text.split('').reduce((acc, char, idx) => {
      return acc + char.charCodeAt(0) * (idx + i + 1);
    }, 0);
    // Normalize to -1 to 1 range using sin
    vector.push(Math.sin(val / 1000));
  }
  return vector;
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

    // Generate query embedding
    const queryEmbedding = generateSimpleEmbedding(message);

    // Search Qdrant for relevant chunks
    let relevantChunks: string[] = [];
    
    if (sops && sops.length > 0) {
      console.log(`Searching ${sops.length} SOPs in Qdrant...`);
      
      const searchResponse = await fetch(`${qdrantUrl}/collections/sop_chunks/points/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': qdrantApiKey,
        },
        body: JSON.stringify({
          vector: queryEmbedding,
          limit: 5,
          with_payload: true,
        }),
      });

      if (searchResponse.ok) {
        const searchResults = await searchResponse.json();
        console.log('Qdrant search results:', JSON.stringify(searchResults.result.map((r: any) => ({
          score: r.score,
          contentPreview: r.payload.content.substring(0, 100)
        }))));
        
        relevantChunks = searchResults.result
          .filter((r: any) => r.score > 0.1) // Lowered threshold for better retrieval
          .map((r: any) => r.payload.content);
        console.log(`Found ${relevantChunks.length} relevant chunks with scores above 0.1`);
      }
    }

    // Construct enhanced prompt with context
    const context = relevantChunks.length > 0
      ? `\n\nRelevant SOP Context:\n${relevantChunks.join('\n\n---\n\n')}`
      : '';

    const systemPrompt = `You are an expert automation engineer. Generate TWO complete, production-ready automation scripts based on the user's request${context ? ' and the provided SOP documentation' : ''}.

${context ? 'IMPORTANT: You have been provided with relevant SOP documentation below. You MUST use this context to inform the automation steps, selectors, workflow logic, and any domain-specific requirements in both scripts.' : ''}

Return your response in this EXACT format:

=== PYTHON_SCRIPT ===
[Complete Python script using Selenium WebDriver]
=== END_PYTHON_SCRIPT ===

=== PLAYWRIGHT_SCRIPT ===
[Complete Node.js Playwright script]
=== END_PLAYWRIGHT_SCRIPT ===

Requirements:
- Both scripts must be complete and executable
- Include all necessary imports and setup
- Add error handling and logging
- ${context ? 'Use the SOP context to inform the automation steps, selectors, and workflow' : 'Generate logical automation steps based on the request'}
- Python script: Use Selenium WebDriver with proper waits (WebDriverWait, EC)
- Playwright script: Use async/await with proper error handling and page.waitForSelector()`;

    const userPrompt = `${message}${context}`;

    console.log('Calling Gemini 2.5 Pro for maximum RAG accuracy...');
    
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
        chunksUsed: relevantChunks.length 
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
