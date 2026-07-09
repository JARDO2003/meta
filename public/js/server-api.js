// Petit helper client pour appeler les endpoints serveur
// Inclure ce fichier dans vos pages HTML AVANT as.js

window.serverApi = (function(){
  async function postJSON(path, body){
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('Erreur réseau');
    return await resp.json();
  }

  // Exemples de wrappers : adaptez le nom et payload selon server/server.js
  async function doThirdPartyAction(payload){
    return await postJSON('/api/thirdparty/do-action', payload);
  }

  return { doThirdPartyAction };
})();
