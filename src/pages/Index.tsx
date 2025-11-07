import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";
const Index = () => {
  return <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">What are we automating today?</h1>
          
          <p className="text-muted-foreground">
            Create powerful Python automation scripts with AI assistance
          </p>
        </div>
        <ChatInterface />
      </div>
    </Layout>;
};
export default Index;