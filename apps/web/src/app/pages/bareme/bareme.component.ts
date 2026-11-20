import { Component } from '@angular/core';

@Component({
  standalone: true,
  template: `<article aria-labelledby="titre">
    <p class="eyebrow">Indices de confort</p>
    <h1 id="titre">Comprendre le barème</h1>
    <p>Une même brise peut convenir au catamaran et gêner une sortie en paddle.
      Littora part de 100 points pour chaque activité et retire des points selon les conditions prévues.
      Chaque déduction est arrondie séparément ; la note ne descend jamais sous zéro.</p>
    <h2>Vent régulier ou rafales ?</h2>
    <p>En catamaran, un vent moyen de 12 à 22 km/h ne coûte aucun point. En planche à voile,
      cette plage va de 15 à 25 km/h. En dehors de ces plages, chaque km/h d’écart coûte 4 points.
      Les rafales ne sont jamais un bonus : chaque km/h au-dessus de la borne haute coûte 2 points.</p>
    <p><strong>Exemple :</strong> en catamaran, un vent de 18 km/h ne retire rien, mais des rafales
      à 30 km/h retirent 16 points : (30 − 22) × 2. Les vagues et le courant comptent ensuite.
      La direction du vent est affichée à titre d’information et n’entre pas dans le calcul.</p>
    <h2>Les points par activité</h2>
    <div class="table-scroll" role="region" aria-label="Coefficients par activité" tabindex="0"><table>
      <caption>Points retirés par unité. « Non » signifie que la mesure n’intervient pas.</caption>
      <thead><tr><th scope="col">Activité</th><th scope="col">Vent<br>km/h</th><th scope="col">Rafales<br>km/h</th><th scope="col">Vagues<br>m</th><th scope="col">Courant<br>m/s</th><th scope="col">UV</th><th scope="col">Eau<br>°C</th></tr></thead>
      <tbody>@for (r of rows; track r[0]) {<tr><th scope="row">{{r[0]}}</th>@for (v of r.slice(1); track $index) {<td>{{v}}</td>}</tr>}</tbody>
    </table></div>
    <p>Pour les UV, seule la part au-dessus de 2 compte. Pour l’eau, c’est l’écart à 20–25 °C.
      Les vagues correspondent à la hauteur significative prévue en mer, pas à la hauteur exacte au bord.</p>
    <h2>Quand une mesure manque</h2>
    <p>« Au plus 72/100 » signifie que les données utilisables ont déjà retiré 28 points.
      Les mesures manquantes ou périmées ne sont pas remplacées par zéro. Elles pourraient faire baisser la note.
      Sans aucune mesure utilisable, il n’y a pas de note. Les indices partiels ne servent pas au classement.</p>
    <h2>Qualité de l’eau et signalements</h2>
    <p>Un prélèvement récent défavorable retire 35 points en baignade et en famille.
      Pour ces deux activités, la pollution signalée peut retirer jusqu’à 22 points et les méduses 12.
      L’affluence peut retirer 6 points en famille. Un courant signalé peut retirer jusqu’à 10 points en baignade ou en famille,
      14 en paddle ou en planche et 7 en bateau ou en catamaran. Le nombre et la confiance des observations modulent la déduction.</p>
    <p><strong>Une interdiction officielle active impose 0/100 en baignade et en famille.</strong>
      En dehors de ce cas, les indices ne sont calculés qu’en mer. Ce barème expérimental exprime une préférence
      de confort, pas une probabilité de sécurité. Il ne remplace ni le drapeau sur place ni les consignes des secours.</p>
  </article>`,
  styles: [`
    article { max-width: 52rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
    h1 { font-size: 2.4rem; line-height: 1.15; } h2 { margin: 2rem 0 .5rem; font-size: 1.4rem; }
    p, caption { line-height: 1.6; } .table-scroll { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
    caption { text-align: left; margin-bottom: .6rem; } th, td { text-align: left; padding: .55rem; border-bottom: 1px solid #c9dada; }
  `],
})
export class BaremeComponent {
  readonly rows = [
    ['Baignade','1','0,5','20','40','2','3'], ['Famille','1','0,6','28','50','3','4'],
    ['Paddle','2','1','28','55','Non','Non'], ['Bateau','1','0,6','22','35','Non','Non'],
    ['Catamaran','4','2','22','35','Non','Non'], ['Planche à voile','4','2','24','40','Non','Non'],
  ];
}
