import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    console.log('Executing Python code...');

    // Use Piston API for code execution
    const response = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        language: 'python',
        version: '3.10.0',
        files: [
          {
            name: 'main.py',
            content: code
          }
        ],
        stdin: '',
        args: [],
        compile_timeout: 10000,
        run_timeout: 3000,
        compile_memory_limit: -1,
        run_memory_limit: -1
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Piston API error:', response.status, errorText);
      throw new Error(`Execution service error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Execution completed');

    return new Response(
      JSON.stringify({
        stdout: result.run.stdout || '',
        stderr: result.run.stderr || '',
        exitCode: result.run.code,
        error: result.run.signal || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in execute-python function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        stdout: '',
        stderr: '',
        exitCode: 1
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
