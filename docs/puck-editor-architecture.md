# Arkitekturplan: Page Builder med Puck Editor i SailRaceManager

Dette dokument beskriver strategien og arkitekturen for at implementere en drag-and-drop page builder i SailRaceManager, så brugere (sejlere, foreninger, teams, stævneledere) selv kan administrere og bygge deres profilsider.

## 1. Valg af Teknologi: Puck Editor

Efter en grundig analyse af React 19 og Tailwind CSS kompatible page builders (inkl. Craft.js, GrapesJS, Builder.io), er valget faldet på **[Puck Editor](https://puckeditor.com/)**.

### Hvorfor Puck?
* **Open Source (MIT):** Ingen vendor lock-in eller løbende SaaS-omkostninger.
* **React Native:** Bygget direkte til React og integrerer gnidningsløst med React 19.
* **Tailwind CSS:** Fungerer perfekt med Tailwind, da vi selv bygger de blokke, der kan trækkes ind.
* **Fuld Kontrol:** I stedet for at give brugerne fuld frihed til at ødelægge designet, definerer vi præcis hvilke React-komponenter ("blokke"), der kan bruges.
* **Data Eje:** Layouts gemmes som simple JSON-objekter i vores egen database.
* **Rollebaseret Adgang:** Pucks indbyggede Permissions API gør det nemt at styre, hvem der må hvad.

## 2. Den Overordnede Arkitektur

I stedet for at have én stor editor, opretter vi specifikke "Builder"-komponenter for hver sidetype. Data (JSON) gemmes i den respektive tabel i databasen.

### Databasestruktur (EAV / JSON)
Hver entitet får et felt til at gemme deres sidelayout:
* `club.page_layout` (JSON)
* `event.page_layout` (JSON)
* `user.page_layout` (JSON)
* `team.page_layout` (JSON)
* `system.index_page_layout` (JSON)

## 3. Sidetyper og Blok-konfigurationer

Nøglen er at give de rigtige blokke til de rigtige brugere. En sejler har ikke brug for en "Tilmeldings-knap til event"-blok, og en klub har ikke brug for en "Mine personlige rekorder"-blok.

### Fælles Blokke (Tilgængelige for alle)
* `Heading`, `Text`, `RichText`, `Image`, `Video`, `Divider`, `Spacer`
* `Columns`, `Grid`, `Section`, `Card`

### A. Index-siden (Forsiden)
* **Hvem redigerer:** SRM Admins
* **Specifikke Blokke:** `HeroVideo`, `FeaturedEvents`, `GlobalLeaderboard`, `Testimonials`, `PricingCards`, `MarketingFeatures`

### B. Klubsider (Foreninger)
* **Hvem redigerer:** Klub-administratorer
* **Specifikke Blokke:** `ClubHero`, `ClubNews`, `UpcomingClubEvents`, `ClubLeaderboard`, `SponsorGrid`, `FacilitiesInfo`, `ContactForm`

### C. Event-sider (Stævner & Kapsejladser)
* **Hvem redigerer:** Event Managers (Stævneledere)
* **Specifikke Blokke:** `EventHeader`, `NoticeOfRace`, `RegisteredBoats`, `LiveTracking`, `ResultsTable`, `EventSponsors`, `NoticeBoard`

### D. Holdsider (Teams)
* **Hvem redigerer:** Team Kaptajn / Skipper
* **Specifikke Blokke:** `TeamHero`, `CrewList`, `TeamTrophyCabinet`, `TeamGallery`, `UpcomingRaces`

### E. Sejler-profiler (Aktivitetssider)
* **Hvem redigerer:** Den enkelte sejler
* **Specifikke Blokke:** `SailorStats`, `ActivityFeed`, `BoatGarage`, `KudosBoard`, `SailingCV`

## 4. Brugeroplevelsen (UX)

Brugeren forlader aldrig SailRaceManager. Der er intet separat "Puck backend".

1. **Visnings-tilstand:** Siden vises normalt med Pucks `<Render />` komponent, der blot renderer JSON-dataene som en færdig side.
2. **Redigerings-tilstand:** Når en autoriseret bruger klikker "Rediger side", skifter siden til Puck-editoren (indlejret på samme URL).
   * **Venstre sidebar:** Liste over tilgængelige blokke.
   * **Midten:** Live preview og drag-and-drop canvas.
   * **Højre sidebar:** Indstillinger for den valgte blok.

## 5. Rettigheder og Roller (Permissions API)

Vi bruger Pucks `permissions` prop til at sikre, at brugerne ikke ødelægger deres egne sider eller sletter obligatoriske elementer.

```javascript
// Eksempel: Event Managers må ikke slette selve "Tilmelding"-blokken
const eventPermissions = {
  delete: (item) => item.type !== 'EventHeader',
  duplicate: true,
  insert: true,
  drag: true,
};
```

## 6. Implementerings-flow i React

```tsx
import { Puck, Render } from "@puckeditor/core";
import { clubConfig } from "./configs/clubConfig";

export function ClubPage({ club, isAdmin }) {
  const [editing, setEditing] = useState(false);

  // Redigerings-tilstand
  if (editing && isAdmin) {
    return (
      <Puck
        config={clubConfig}
        data={club.pageLayout}
        onPublish={async (data) => {
          await saveClubLayout(club.id, data);
          setEditing(false);
        }}
        iframe={{ enabled: false }} // Arv globale Tailwind styles
      />
    );
  }

  // Visnings-tilstand
  return (
    <div>
      {isAdmin && (
        <button onClick={() => setEditing(true)}>✏️ Rediger side</button>
      )}
      <Render config={clubConfig} data={club.pageLayout} />
    </div>
  );
}
```

## 7. Fordele for SailRaceManager

1. **Konsistens:** Fordi vi bygger blokkene, vil siderne altid matche SailRaceManagers brand ("moderne, sport, resultater").
2. **Modulær Arkitektur:** Passer perfekt ind i den eksisterende arkitektur. Nye features (f.eks. et Protest-modul) bliver bare til en ny blok, der tilføjes til `eventConfig`.
3. **Strava-følelsen:** Giver sejlerne de rigtige byggeklodser til at bygge deres egen identitet og dele den.
