import { createClient } from '@supabase/supabase-js';

// Supabase project credentials
const SUPABASE_URL = 'https://yydqqtildcjzclzvieza.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5ZHFxdGlsZGNqemNsenZpZXphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzY4NDUsImV4cCI6MjA5MzQ1Mjg0NX0.82XioLmEJ040Wq4NchCg2F5FJ3dG8UWUTieG8gSC-UI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
