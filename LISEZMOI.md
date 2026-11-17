# Compta Banque

Logiciel Windows pour **l'ACEL Saint-Médard** (compte 01 quotidien, compte 02 activités) et **les Jeunes de Saint-Médard** (compte courant) :

- import des **relevés PDF** de la banque (ou copier-coller depuis Excel), avec contrôle automatique : solde de départ + opérations = solde final, et repérage des opérations déjà importées ;
- **classement automatique** par catégories grâce à des règles « le libellé contient… → catégorie » (le mot-clé le plus long l'emporte) ; quand vous classez une opération à la main, le logiciel propose de créer la règle ;
- **n° de facture** sur chaque opération, filtre « dépenses sans n° de facture » ;
- catégorie **N-1 (année précédente)** pour ce qui est payé ou encaissé cette année mais concerne l'année d'avant : lignes **en jaune** partout, et **hors du résultat de l'année** (totaux, synthèse, export) ; elles apparaissent à part, sous le total. En début d'année, les opérations dont le libellé mentionne l'année passée (« DEC 2025 », « 202512 », « SOLDE 2025 »…) sont signalées « N-1 ? » : un clic pour confirmer ou écarter ;
- **ventilation** d'une opération sur plusieurs catégories (ex. une remise de chèques qui mélange familles et associations) ;
- **synthèse mois par catégorie** (année civile ou scolaire), un clic sur un montant affiche les opérations ;
- **numéro de compte comptable** sur chaque catégorie (plan comptable des associations) et **export Excel pour le comptable** : opérations, journal de banque en partie double, récapitulatif par compte, tableau par mois, liste des points à vérifier.

## Contrôles de sécurité comptable

- **Montants en centimes** pour tous les contrôles (aucune erreur d'arrondi).
- **Doublons** à l'import : comptés un par un (deux achats identiques le même jour restent deux opérations) ; « doublon probable » si même compte, même date, même montant mais libellé différent (même relevé lu en PDF puis collé).
- **Contrôle de chaque relevé** : solde de début + opérations = solde de fin, totaux du relevé, montants illisibles, lignes avec débit et crédit.
- **Rapprochement bancaire** (page Importer) : chaque relevé importé doit toujours retomber sur son solde de fin et reprendre le solde de fin du précédent ; une opération supprimée, en double ou un relevé manquant apparaît en rouge. Solde du compte affiché.
- **Ventilation** : impossible de dépasser le montant ; un reste non réparti reste « À classer », le journal de banque est toujours équilibré.
- **Clôture d'exercice** (Paramètres) : les catégories sont figées, plus aucune modification, suppression ni import pour l'année ; réouverture notée dans l'historique.
- **Traçabilité** : historique des modifications avec le prénom, détail des opérations supprimées (et copie gardée dans le fichier).
- **Enregistrement sûr** : numéro de révision pour détecter qu'un autre ordinateur a enregistré entre-temps (votre version est alors gardée dans « Sauvegardes »), écriture via fichier temporaire relu avant remplacement, nouvel essai automatique si OneDrive bloque le fichier, enregistrement forcé à la fermeture de la fenêtre.

## Fabriquer le .exe avec GitHub

1. Sur github.com, créez un dépôt **privé** (bouton « New », cochez « Private »), par exemple `compta-banque`.
2. Dans le dépôt : **Add file → Upload files**, puis glissez **tout le contenu** de ce dossier (y compris le dossier `.github`). Validez avec « Commit changes ».
3. Ouvrez l'onglet **Actions** : la fabrication « Construire le .exe Windows » démarre toute seule (environ 5 minutes). Si GitHub demande d'activer les Actions, acceptez.
4. Quand la ligne est verte ✔, cliquez dessus ; en bas, dans **Artifacts**, téléchargez **Compta-Banque-Windows** (un .zip).
5. Dans le .zip, deux fichiers :
   - `Compta-Banque-1.4.0-portable.exe` : se lance directement, sans installation ;
   - `Compta-Banque-1.4.0-installation.exe` : installe le logiciel avec un raccourci sur le Bureau.

Windows peut afficher « Windows a protégé votre ordinateur » (le .exe n'est pas signé) : cliquez sur **Informations complémentaires → Exécuter quand même**.

Pour une nouvelle version : modifiez le numéro `"version"` dans `package.json`, renvoyez les fichiers modifiés sur GitHub, et récupérez le nouveau .exe dans Actions.

## Premier lancement

1. Indiquez votre prénom (il apparaît dans l'historique des modifications), puis choisissez **le dossier OneDrive partagé** où ranger les données. Chaque personne (Pierre, Katell, Lucas…) choisit le même dossier.
2. Pour reprendre le classeur Excel de l'ACEL (compte 01, janvier à octobre 2026), placez le fichier `ACEL Saint-Médard.compta.json` dans ce dossier **avant** le premier lancement, ou utilisez ensuite **Paramètres → Importer un fichier de données…**.
3. Les Jeunes de Saint-Médard démarrent avec une liste de catégories déjà reliées à des numéros de compte (6064 bureautique, 706 participations des familles, 756 adhésions, 74 CAF…). **Faites valider ces numéros par votre comptable** : ils se modifient dans « Catégories et règles ».

## Où sont les données ?

Dans le dossier choisi, un fichier par association :

- `ACEL Saint-Médard.compta.json`
- `Les Jeunes de Saint-Médard.compta.json`
- `Sauvegardes\` : une copie par jour, les 30 derniers jours sont gardés.

Si deux personnes modifient la même association en même temps, le logiciel le détecte, recharge la dernière version et vous demande de refaire votre dernière modification. Ces fichiers ne doivent **pas** être envoyés sur GitHub (le fichier `.gitignore` les exclut).

## Pour les curieux

- `main.js` : fenêtre, fichiers, lecture des PDF (avec pdf.js), enregistrement de l'export Excel.
- `src/logic.js` : catégorisation, moyens de paiement, lecture du copier-coller, contrôles.
- `src/pdf-releve.js` : reconnaissance du tableau Date / Opération / Débit / Crédit dans le PDF.
- `src/export.js` et `src/xlsx.js` : export comptable.
- `src/modeles.js` : catégories et règles de départ des Jeunes de Saint-Médard.
- `renderer/` : l'interface.
- `tests/` : tests lancés automatiquement par GitHub avant chaque fabrication (`npm test`).
- Touche **F12** dans le logiciel : outils de diagnostic.
