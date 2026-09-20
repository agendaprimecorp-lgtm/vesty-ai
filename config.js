/* Vesty Aí — configuração do aplicativo.
   A chave publicável é feita para ficar no navegador: sozinha ela não dá acesso
   a nada. Quem protege os dados é a política de acesso do banco (RLS), que só
   entrega a cada cliente as próprias peças. Nunca coloque aqui a chave
   "service_role" — essa ignora todas as proteções. */

window.VESTY_CONFIG = {
  supabaseUrl: "https://oumfcekiweqfthrppomo.supabase.co",
  supabaseKey: "sb_publishable_4n-bCgbAvN8Pkid3F3R9TA_CsXV6xB5",
};
