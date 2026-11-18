# Cours de maths — gestion d'emploi du temps

Site statique (GitHub Pages) + base de données et comptes (Supabase, offre gratuite).

```
index.html, app.js, style.css   → le site
config.js                       → les 2 valeurs à renseigner (URL + clé Supabase)
supabase/schema.sql             → à coller dans Supabase (tables + droits d'accès)
supabase/functions/invite/      → fonction serveur qui génère les liens d'invitation
```

Durée totale de mise en place : 30 à 45 min. Les noms de menus ci-dessous correspondent à l'interface de novembre 2026 ; un libellé peut légèrement différer.

---

## Étape 1 — Créer le projet Supabase

1. Aller sur **https://supabase.com** → bouton **Start your project** → se connecter avec **Continue with GitHub** (crée le compte Supabase en même temps).
2. Si demandé, créer une organisation : nom libre (ex. `perso`), type **Personal**, plan **Free** → **Create organization**.
3. Écran **Create a new project** :
   - **Project name** : `cours-maths`
   - **Database Password** : cliquer **Generate a password**, puis le copier dans un gestionnaire de mots de passe (il ne servira pas au quotidien).
   - **Region** : **West EU (Paris)** (ou Central EU (Frankfurt)).
   - Laisser les options de sécurité par défaut (**Data API + Connection String**).
   - **Create new project**. Attendre 1 à 2 min que le projet soit prêt.

## Étape 2 — Créer la base de données

1. Menu de gauche → **SQL Editor** (icône `>_`).
2. Bouton **+ New query** (ou **+** → **Create a new snippet**).
3. Ouvrir le fichier `supabase/schema.sql` dans un éditeur de texte, **tout copier**, coller dans la zone de l'éditeur.
4. Cliquer **Run** (en bas à droite, ou `Ctrl + Entrée`).
   - Si une fenêtre avertit d'une « destructive operation » (à cause des `drop … if exists`), cliquer **Run this query**.
   - Résultat attendu : **Success. No rows returned**.

## Étape 3 — Régler l'authentification

1. Menu de gauche → **Authentication** → section **Configuration** → **Sign In / Providers**.
   - Désactiver **Allow new users to sign up** → **Save changes**.
     *(Plus personne ne peut créer de compte seul ; seuls vos liens d'invitation fonctionnent.)*
   - Laisser le fournisseur **Email** activé.
2. Toujours dans **Sign In / Providers**, cliquer sur la ligne **Email** pour ouvrir ses réglages :
   - **Email OTP Expiration** : mettre `86400` (= 24 h, durée de validité des liens d'invitation) → **Save**.
3. **Authentication** → **URL Configuration** → **Site URL** : vous y mettrez l'adresse du site à l'étape 8.

## Étape 4 — Créer votre compte administrateur

1. **Authentication** → **Users** → bouton **Add user** → **Create new user**.
2. Saisir votre e-mail et un mot de passe, **cocher Auto Confirm User** → **Create user**.
3. Retour dans **SQL Editor** → **+ New query** → coller en remplaçant l'e-mail :
   ```sql
   update public.profiles set role = 'admin' where email = 'votre.email@exemple.fr';
   select email, role from public.profiles;
   ```
   → **Run**. Le tableau du bas doit afficher votre e-mail avec `admin`.

## Étape 5 — Déployer la fonction d'invitation

1. Menu de gauche → **Edge Functions** → bouton **Deploy a new function** → **Via Editor**.
2. Effacer tout le code d'exemple, puis coller **tout** le contenu de `supabase/functions/invite/index.ts`.
3. En bas de l'éditeur, champ du nom de la fonction : saisir exactement **`invite`** (minuscules).
4. Cliquer **Deploy function**. Attendre la confirmation.
5. Sur la page de la fonction `invite` → onglet **Details** → désactiver **Verify JWT with legacy secret** (ou **Enforce JWT verification**) → **Save changes**.
   *(La fonction vérifie elle-même que l'appelant est connecté et administrateur ; ce réglage évite des refus parasites avec les nouvelles clés Supabase.)*

## Étape 6 — Récupérer l'URL et la clé publique

1. Icône **roue dentée** en bas à gauche (**Project Settings**) → **Data API** : copier la **Project URL** (`https://xxxxxxxx.supabase.co`).
2. **Project Settings** → **API Keys** : copier la **Publishable key** (commence par `sb_publishable_…`).
   - S'il n'y a que l'onglet **Legacy API Keys**, copier la clé **anon public** : elle fonctionne aussi.
   - Ne **jamais** utiliser la clé `secret` / `service_role` dans le site.

## Étape 7 — Mettre le site sur GitHub

1. Sur **https://github.com**, en haut à droite **+** → **New repository**.
   - **Repository name** : `cours-maths`
   - **Public** (requis pour GitHub Pages gratuit ; le code ne contient aucun secret, les données sont dans Supabase).
   - Ne rien cocher d'autre → **Create repository**.
2. Sur la page du dépôt vide, cliquer le lien **uploading an existing file**.
3. Glisser-déposer les fichiers **`index.html`, `app.js`, `style.css`, `config.js`, `README.md`** (le dossier `supabase/` est facultatif).
4. En bas : **Commit changes**.
5. Dans la liste des fichiers, cliquer **`config.js`** → icône **crayon** (*Edit this file*) en haut à droite du fichier.
   - Remplacer `https://VOTRE-PROJET.supabase.co` par la Project URL (étape 6.1).
   - Remplacer `VOTRE_CLE_PUBLIQUE` par la clé publique (étape 6.2). Garder les apostrophes.
   - Facultatif : ajuster `DAY_START_HOUR` / `DAY_END_HOUR` (plage horaire affichée).
   - Bouton vert **Commit changes…** → **Commit changes**.

## Étape 8 — Activer GitHub Pages

1. Dans le dépôt : onglet **Settings** → menu de gauche, section *Code and automation* → **Pages**.
2. **Build and deployment** → **Source** : **Deploy from a branch**.
3. **Branch** : `main`, dossier `/ (root)` → **Save**.
4. Attendre 1 à 2 min puis recharger la page : un bandeau indique **Your site is live at `https://VOTRE-PSEUDO.github.io/cours-maths/`**.
5. Copier cette adresse dans Supabase : **Authentication** → **URL Configuration** → **Site URL** → **Save changes**.

## Étape 9 — Tester de bout en bout

1. Ouvrir le site → se connecter avec le compte admin.
2. Onglet **Calendrier** : cliquer (ou cliquer-glisser) sur quelques cases de la semaine prochaine pour les ouvrir (vert).
3. Onglet **Élèves** → saisir une **autre** adresse e-mail à vous → **Générer le lien d'invitation** → **Copier**.
4. Ouvrir une **fenêtre de navigation privée**, coller le lien → **Activer mon accès** → choisir un mot de passe → compléter le profil.
5. Onglet **Réserver** : cliquer un créneau libre, puis un autre plus bas le même jour → **Envoyer la demande**.
6. Revenir dans la fenêtre admin → **Tableau de bord** → **Accepter**.

---

## Utilisation courante

| Action | Où |
|---|---|
| Ouvrir / fermer des créneaux | **Calendrier** : clic sur une case, ou cliquer-glisser sur ordinateur. Bouton **Copier les dispos de la semaine précédente** pour aller vite. |
| Inviter un élève | **Élèves** → e-mail → **Générer le lien d'invitation** → copier et envoyer vous-même (SMS, WhatsApp…). |
| Élève qui a oublié son mot de passe | **Élèves** → **Générer un lien de connexion** sur sa fiche → l'envoyer ; il choisira un nouveau mot de passe. |
| Valider / refuser une demande | **Tableau de bord** → *Demandes en attente*. |
| Annuler un cours | **Tableau de bord** → *Cours à venir* → **Annuler le cours** (le créneau redevient libre). |
| Payé / notes de séance | **Tableau de bord** → case **Payé**, zone **Notes de séance** → **Enregistrer les notes**. L'élève les voit en lecture seule. |
| Supprimer un élève | Supabase → **Authentication** → **Users** → menu **⋮** sur la ligne → **Delete user** (supprime aussi son profil et ses cours). |

**Règles appliquées par la base** (impossibles à contourner depuis le navigateur) : un élève ne voit que « libre / pris » sur le calendrier, uniquement son profil et ses cours ; il ne peut demander que des créneaux ouverts, futurs et non pris ; il peut retirer une demande tant qu'elle est en attente ; il ne peut ni valider, ni annuler un cours confirmé, ni modifier payé / notes.

## À savoir

- **Mise en veille** : Supabase met en pause un projet gratuit après ~7 jours sans activité (ex. vacances). Les données sont conservées ; il suffit de cliquer **Restore project** dans le tableau de bord Supabase.
- **Liens** : à usage unique, valables 24 h (réglage de l'étape 3.2). Un lien expiré se régénère depuis l'onglet **Élèves**.
- **Données personnelles** : les coordonnées des élèves (souvent mineurs) sont stockées chez Supabase (région UE choisie à l'étape 1). Supprimer le compte d'un élève quand il arrête les cours.
- **Modifier le site** : éditer un fichier sur GitHub (icône crayon) → *Commit* ; le site est mis à jour en 1 à 2 min.
