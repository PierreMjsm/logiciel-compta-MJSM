# Compta Banque

**Trois espaces complètement séparés**, chacun avec sa couleur, ses opérations, ses catégories, ses règles, son rapprochement et son export : **ACEL – Compte 01** (quotidien, bleu), **ACEL – Compte 02** (activités, prune) et **Les Jeunes de Saint-Médard** (vert). On choisit l'espace à gauche ; un bandeau de la même couleur rappelle en haut de chaque page où l'on se trouve. Les comptes ne sont jamais mélangés.

Au premier lancement de la version 1.5, l'ancien fichier `ACEL Saint-Médard.compta.json` (comptes 01 et 02 ensemble) est automatiquement coupé en deux fichiers, `ACEL Compte 01 - Quotidien.compta.json` et `ACEL Compte 02 - Activités.compta.json` ; l'ancien est renommé « (avant séparation des comptes) » et gardé. Le compte 01 garde les catégories et les règles existantes ; le compte 02 démarre avec ses propres catégories, sans règle.

Logiciel Windows pour **l'ACEL Saint-Médard** (compte 01 quotidien, compte 02 activités) et **les Jeunes de Saint-Médard** (compte courant) :

- import des **relevés PDF** de la banque (testé sur de vrais relevés CIC — ACEL — et La Banque Postale — Jeunes de Saint-Médard) (ou copier-coller depuis Excel), avec contrôle automatique : solde de départ + opérations = solde final, et repérage des opérations déjà importées ;
- **classement automatique** par catégories grâce à des règles « le libellé contient… → catégorie » (le mot-clé le plus long l'emporte) ; quand vous classez une opération à la main, le logiciel propose de créer la règle ;
- **n° de facture** sur chaque opération, filtre « dépenses sans n° de facture » ;
- catégorie **N-1 (année précédente)** pour ce qui est payé ou encaissé cette année mais concerne l'année d'avant : lignes **en jaune** partout, et **comptées dans le résultat de l'année qu'elles concernent** : le loyer de décembre 2025 payé en janvier 2026 s'ajoute à 2025 et pas à 2026 (synthèse, comparaison, export). En début d'année, les opérations dont le libellé mentionne l'année passée (« DEC 2025 », « 202512 », « SOLDE 2025 »…) sont signalées « N-1 ? » : un clic pour confirmer ou écarter ;
- **ventilation** d'une opération sur plusieurs catégories (ex. une remise de chèques qui mélange familles et associations) ;
- **synthèse mois par catégorie** (année civile ou scolaire), un clic sur un montant affiche les opérations ;
- **comparaison de deux années** (Synthèse → « Comparer deux années ») : montant de chaque année par catégorie, écart en € et en %, à période égale si l'année en cours n'est pas finie, avec une alerte si une année a des mois sans relevé ;
- **Budget et résultat des Jeunes de Saint-Médard** : mêmes fonctions, avec les postes du tableau « Comptes » (participation des familles, subventions CAF, aide à l'apprentissage… redevance ACEL) ; sans budget saisi, le tableau compare le réalisé à l'année précédente ; données dans `Les Jeunes de Saint-Médard Budget.compta.json` ;
- **Enregistrer en PDF** (Budget et résultat, Synthèse, Comparaison) : document A4 paysage propre, sans menus ni boutons, pour le CA ;
- **Prévisionnel ACEL** (dans les espaces ACEL) : le seul écran qui additionne les comptes 01 et 02. Budget voté, réactualisé, réalisé (banque à date ou comptes arrêtés saisis), % du budget, estimé de fin d'année (reste de l'année au rythme de l'année précédente, ou selon le budget), réalisé de l'année précédente et évolution. Chaque catégorie des deux comptes est rattachée à un poste du budget ; les données sont dans `ACEL Prévisionnel.compta.json` ;
- **Reste disponible** (dans chaque espace, pensé pour les Jeunes de Saint-Médard) : pour chaque mois, solde de début, recettes, dépenses habituelles (salaires, charges, loyer… : cases à cocher sur la page), autres dépenses, solde de fin, puis **ce qui reste à utiliser** pour du matériel ou d'autres achats une fois mis de côté un nombre de mois de dépenses habituelles (moyenne des 6 derniers mois) et une marge de sécurité, réglables. Le solde vient des relevés PDF importés (ou d'un solde de départ saisi). Enregistrable en PDF ;
- **Demandes de subvention** (espaces ACEL) : préparation des deux demandes annuelles à Avenir Censier. On saisit le montant voté en AG, la date de l'AG, le montant et la date de chaque demande ; le logiciel rédige la lettre (montant en chiffres et en lettres, modifiable) et le **plan de trésorerie du compte 01** : trésorerie au 31/12, sommes N-1, réalisé par trimestre d'après la banque jusqu'à la date de la lettre, loyers et subventions sur des lignes à part (« Loyer 4e trimestre 2025 » quand le libellé bancaire indique le trimestre), puis prévisions jusqu'au 31/12 (proposées automatiquement, modifiables). Le texte de chaque ligne du plan se modifie (les montants du réalisé viennent toujours de la banque). Le solde est contrôlé avec le relevé. Les versements reçus d'Avenir Censier sont retrouvés en banque (comptes 01 et 02), avec un bouton pour les classer en « Subvention ». **Enregistrer la demande en PDF** donne un document A4 portrait de deux pages : la lettre et le plan de trésorerie. Données dans `ACEL Prévisionnel.compta.json` ;
- **numéro de compte comptable** sur chaque catégorie (plan comptable des associations) et **export Excel pour le comptable** : opérations, journal de banque en partie double, récapitulatif par compte, tableau par mois, liste des points à vérifier.

## Années, relevés et vérification

- **Toutes les années restent dans le même fichier**, sur OneDrive. Rien à faire pour « commencer » une année : importez le relevé de janvier, il se range tout seul. La page Opérations s'ouvre sur l'année la plus récente (menu « Année » pour changer) ; la synthèse et l'export se font par année civile ou scolaire.
- **Fin d'année** : Paramètres → Exercices → « Clôturer ». L'année reste consultable et exportable, mais plus rien ne peut y être modifié.
- **Doublons historique / relevé** : si des opérations saisies sans relevé (classeur Excel, copier-coller) sont importées une seconde fois avec le relevé PDF, la page Importer les signale ; « Fusionner » garde l'opération du relevé en reprenant catégorie, n° de facture et note. À l'import, « tout cocher » ne coche plus les opérations déjà présentes, et une confirmation est demandée si on en coche.
- **Bon compte** : le numéro du compte écrit sur le relevé est retenu au premier import ; un relevé d'un autre compte (ex. le compte 02 importé dans l'espace du compte 01) est signalé et ses opérations sont décochées.
- **Après un import**, tout le relevé est affiché (les opérations à classer sont en orange). Quand un filtre (catégorie, recherche…) cache des opérations, une ligne le signale en bas du tableau avec un bouton « Les afficher ». De même, quand on regarde un mois ou une année, la ligne indique combien d'opérations du même filtre sont dans d'autres années (lien direct vers l'année).
- **Relevés importés** (page Importer) : liste par année avec le contrôle des soldes, l'état « vérifié », le PDF d'origine et la suppression.
- **Vérifier un relevé** : « Vérifier » affiche ses opérations dans l'ordre du relevé avec soldes et totaux ; « Ouvrir le PDF pour comparer » ouvre l'original, copié à l'import dans `Relevés/<espace>/<année>/` du dossier des données ; « Marquer comme vérifié » note qui a vérifié et quand.
- **Supprimer un relevé importé par erreur** : supprime le relevé et toutes ses opérations (refusé si l'année est clôturée), avec avertissement si du travail a déjà été fait dessus ; le détail est gardé dans l'historique, le PDF part dans `Sauvegardes/Relevés supprimés`. On peut ensuite réimporter le bon relevé.

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
   - `Compta-Banque-1.13.5-portable.exe` : se lance directement, sans installation ;
   - `Compta-Banque-1.13.5-installation.exe` : installe le logiciel avec un raccourci sur le Bureau.

Windows peut afficher « Windows a protégé votre ordinateur » (le .exe n'est pas signé) : cliquez sur **Informations complémentaires → Exécuter quand même**.

Pour une nouvelle version : modifiez le numéro `"version"` dans `package.json`, renvoyez les fichiers modifiés sur GitHub, et récupérez le nouveau .exe dans Actions.

## Premier lancement

1. Indiquez votre prénom (il apparaît dans l'historique des modifications), puis choisissez **le dossier OneDrive partagé** où ranger les données. Chaque personne (Pierre, Katell, Lucas…) choisit le même dossier.
2. Pour reprendre le classeur Excel de l'ACEL (compte 01, janvier à octobre 2026), placez le fichier `ACEL Compte 01 - Quotidien.compta.json` dans ce dossier **avant** le premier lancement, ou utilisez ensuite **Paramètres → Importer un fichier de données…**.
3. Les Jeunes de Saint-Médard démarrent avec une liste de catégories déjà reliées à des numéros de compte (6064 bureautique, 706 participations des familles, 756 adhésions, 74 CAF…). **Faites valider ces numéros par votre comptable** : ils se modifient dans « Catégories et règles ».

## Où sont les données ?

Dans le dossier choisi, un fichier par espace :

- `ACEL Compte 01 - Quotidien.compta.json`
- `ACEL Compte 02 - Activités.compta.json`
- `Les Jeunes de Saint-Médard.compta.json`
- `Sauvegardes\` : une copie par jour, les 30 derniers jours sont gardés.

Si deux personnes modifient la même association en même temps, le logiciel le détecte, recharge la dernière version et vous demande de refaire votre dernière modification. Ces fichiers ne doivent **pas** être envoyés sur GitHub (le fichier `.gitignore` les exclut).

## Pour les curieux

- `main.js` : fenêtre, fichiers, lecture des PDF (avec pdf.js), enregistrement de l'export Excel.
- `src/logic.js` : catégorisation, moyens de paiement, lecture du copier-coller, contrôles.
- `src/pdf-releve.js` : reconnaissance du tableau Date / Opération / Débit / Crédit dans le PDF.
- `src/export.js` et `src/xlsx.js` : export comptable.
- `src/tresorerie.js` : solde à une date, reste disponible, plan de trésorerie et lettre de demande de subvention.
- `src/modeles.js` : catégories et règles de départ des Jeunes de Saint-Médard.
- `renderer/` : l'interface.
- `tests/` : tests lancés automatiquement par GitHub avant chaque fabrication (`npm test`).
- Touche **F12** dans le logiciel : outils de diagnostic.
