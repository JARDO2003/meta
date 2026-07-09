Cette branche ajoute un serveur Node/Express minimal qui permet de déplacer les secrets (API keys, service account) côté serveur.

Fichiers ajoutés:
- server/server.js : serveur d'exemple exposant des endpoints protégés par les secrets server-side
- server/.env.example : exemple de variables d'environnement (NE PAS COMMITTER les vraies valeurs)
- public/js/server-api.js : fonctions client pour appeler les endpoints serveur
- .gitignore : ignore .env et fichiers de clé
- MIGRATE_SECRETS.md : guide de migration

Instructions rapides :
1) Cloner la branche "move-secrets-to-server"
2) Aller dans /server
3) Copier server/.env.example -> .env et remplir les valeurs
4) npm install
5) npm start (ou node server.js)
6) Inclure "public/js/server-api.js" dans votre page avant as.js et remplacer les appels côté client qui utilisaient des clés par window.serverApi.*

Je peux aider à automatiser le remplacement dans as.js si vous confirmez vouloir que je modifie le fichier client pour appeler ces endpoints.
