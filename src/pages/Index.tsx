import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">AI Workflow Generator</h1>
          <p className="text-muted-foreground mt-1">
            Create powerful Python automation scripts with AI assistance
          </p>
        </div>
        <ChatInterface />
      </div>
    </Layout>
  );
};

export default Index;
