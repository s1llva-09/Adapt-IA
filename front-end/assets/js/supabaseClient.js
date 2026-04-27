// Importa a função createClient da biblioteca do Supabase
import { createClient } from "https://esm.sh/@supabase/supabase-js";

// Configuração do projeto supabase


//URL DO PROJETO
const SUPABASE_URL = "https://igxwizukbumsbgpgyqca.supabase.co/rest/v1/"

//Chave publica (anon key)

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlneHdpenVrYnVtc2JncGd5cWNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNDUyMjIsImV4cCI6MjA5MjgyMTIyMn0.ykeu93ujozC_Ou-6tWI0-xnZ5qe0EIsHbX9XX_HB2dU"

//Conexão com o supabase para efetuar: login, cadastro, logout, etc
export const supabse = createClient (
    SUPABASE_URL, //endereço do projeto
    SUPABASE_ANON_KEY //chave publica do projeto
)