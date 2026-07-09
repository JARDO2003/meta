Migration des secrets exposés dans as.js

Étapes effectuées par cette branche :
1) Ajout d'un serveur Node/Express minimal (server/server.js) qui contient des endpoints à appeler depuis le client au lieu d'exposer des clés.
2) Ajout d'un helper client (public/js/server-api.js) à inclure avant as.js pour remplacer l'utilisation directe des clés.
3) Ajout d'un .env.example et d'un .gitignore pour éviter de commit les secrets.

Actions recommandées supplémentaires (manuelles ou à automatiser) :
- Rechercher et supprimer toutes les occurrences de clés littérales dans as.js :
  grep -nE "apiKey|API_KEY|client_secret|clientSecret|private_key|serviceAccount|FIREBASE|firebase|TOKEN|Authorization|Bearer|password" as.js

- Pour chaque appel direct utilisant une clé, remplacer par un appel à window.serverApi.* ou ajouter un endpoint spécifique côté serveur.

- Si une clé a déjà été committée, la révoquer et purger l'historique git (bfg, git filter-repo), puis pousser et forcer les mises à jour pour les utilisateurs.

Si vous souhaitez, je peux :
- Modifier automatiquement as.js pour remplacer occurrences identifiées par appels vers window.serverApi (indiquez si l'application peut faire des requêtes cross-origin vers le serveur), ou
- Chercher automatiquement les littéraux sensibles dans as.js et lister les lignes pour que vous validiez avant modification.
