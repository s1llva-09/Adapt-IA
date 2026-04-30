// Cliente oficial do Supabase carregado
// Ele permite usar auth, tabelas, insert, select, update e delete no front-end.
import { createClient } from "https://esm.sh/@supabase/supabase-js";

// URL raiz do projeto Supabase.
// Importante: para autenticação, a URL deve ser a raiz do projeto, sem /rest/v1.
const SUPABASE_URL = "https://igxwizukbumsbgpgyqca.supabase.co";

// Chave publica anon do Supabase.
// Ela pode ficar no front-end, mas as regras de seguranca devem ficar no Supabase
// usando RLS/policies nas tabelas.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlneHdpenVrYnVtc2JncGd5cWNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNDUyMjIsImV4cCI6MjA5MjgyMTIyMn0.ykeu93ujozC_Ou-6tWI0-xnZ5qe0EIsHbX9XX_HB2dU";

// Instancia unica do cliente.
// Todos os outros arquivos importam este objeto para falar com o Supabase.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Compatibilidade com arquivos antigos que ainda importam "supabse".
// O nome correto e "supabase", mas manter isso evita quebrar codigo antigo.
export const supabse = supabase;
