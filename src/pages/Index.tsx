import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";
import { useAuth } from "@/hooks/useAuth";
const Index = () => {
  const { userProfile } = useAuth();
  const firstName = userProfile?.full_name?.split(' ')[0] || 'there';
  
  return <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">What are we automating today, {firstName}?</h1>
          
          <p className="text-muted-foreground">
            Create powerful Python automation scripts with AI assistance
          </p>
        </div>
        <ChatInterface />
      </div>
    </Layout>;
};
export default Index;