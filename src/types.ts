export interface BlogPost {
  id: string;
  title: string;
  published: string; // YYYY-MM-DD
  content: string;   // Markdown or Text
  labels: string[];
  url?: string;
  importance_score?: string;
}
