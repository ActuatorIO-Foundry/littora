# Avis picomatch et preversion

L'avis [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),
revu le 17 novembre 2026, affecte les versions jusqu'a 4.0.7 incluse. A cette date,
aucune version corrigee n'est publiee. Le suivi avant ouverture est #45.

Le lockfile utilise 2.3.2 et 4.0.4 uniquement comme dependances de developpement
du build Angular, de Vite, webpack et des outils de globbing. Les quatre
occurrences sont marquees `dev: true`. `npm ls picomatch --omit=dev --all` ne
retourne aucune dependance d'execution. Le Web de production sert des fichiers
statiques ; le serveur de developpement doit rester lie au loopback.
Les configurations et motifs de build sont du code de confiance a revoir dans
les PR, pas des expressions acceptees par les endpoints publics de Littora.

## Exception de recette

L'exception est limitee a cet avis, a ces deux versions et aux dependances de
developpement, jusqu'au 24 novembre 2026 exclu. Elle permet les lots de recette
sur `architecture` ; elle ne valide pas une ouverture publique. Aucun code tiers
n'est patche localement et aucun downgrade Angular n'est applique.

`npm run audit` lit le rapport npm reel et le lockfile. Toute autre vulnerabilite,
version inattendue, occurrence d'execution, echeance atteinte, rapport incomplet
ou correctif direct annonce par npm bloque le controle. Les dependances affectees
transitivement ne sont acceptees que si tous leurs avis remontent a cette seule
exception et si elles restent toutes de developpement. Le resultat affiche
explicitement l'avis et le nombre de dependances affectees, jamais "zero alerte".

`npm run audit:strict` conserve le controle npm sans exception. Il reste en echec
tant que l'avis est present. `npm run docker:prod` refuse le deploiement tant que
l'exception npm ou celle des images existe. La V1 officielle doit attendre la
resolution et la revue de sortie ; ce point n'est pas une amelioration post-V1.

## Retrait

Verifier les versions et le correctif amont, mettre a jour les branches concernees,
rejouer installation propre, tests d'outillage, builds et parcours navigateur.
Retirer l'exception et adapter le test des versions autorisees. Les scans des
images d'execution restent independants et obligatoires. Les rapports bruts
et journaux d'execution ne sont pas versionnes.
