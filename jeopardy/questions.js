// ============================================================
// BABY SHOWER JEOPARDY — GAME CONTENT
// ============================================================
// These are the BUILT-IN questions. Questions saved from the
// admin screen (jeopardy/admin.html) take priority over this file;
// this set is used when nothing is saved there, and it's what
// "Reset to built-in questions" goes back to.
//
// STRUCTURE:
//   - Exactly 5 clues per category (classic Jeopardy column of 5).
//   - You can have as many categories as you want — the board
//     grid adjusts automatically (classic Jeopardy uses 6).
//   - "value" is the point award for getting the clue right.
//   - "clue" is what's shown/read aloud first.
//   - "answer" is revealed after — written Jeopardy-style as a
//     question ("What is...?") if you want the classic flavor,
//     but totally optional — plain answers work fine too.
// ============================================================

window.GAME_DATA = {
  title: "Baby Shower Jeopardy!",
  subtitle: "Get ready to question everything (literally)",

  // Shown next to every point value on the board, e.g. "100 pts"
  currencyLabel: "pts",

  // Note: team names/count are NOT set here anymore — they're registered
  // once on the Leaderboard page and shared across every game in the app.

  categories: [
    {
      title: "Baby Basics",
      clues: [
        { value: 100, clue: "A pregnancy usually lasts about this many weeks", answer: "40" },
        { value: 200, clue: "The position babies should sleep in", answer: "Flat on their backs (supine position)" },
        { value: 300, clue: "The soft spot on top of a newborn's head is called this", answer: "Fontanelle" },
        { value: 400, clue: "Most babies get their first tooth at about this age", answer: "Around 6 months" },
        { value: 500, clue: "The average number of nappies a newborn uses per day", answer: "8-12" }
      ]
    },
    {
      title: "Nursery Rhymes",
      clues: [
        { value: 100, clue: "The Incy Wincy Spider climbed up this", answer: "The water spout" },
        { value: 200, clue: "Humpty Dumpty sat on one of these", answer: "A wall" },
        { value: 300, clue: "What happens when the bough breaks in \"Rock-a-bye Baby\"", answer: "The cradle falls" },
        { value: 400, clue: "Which little piggy had roast beef", answer: "The third piggy" },
        { value: 500, clue: "She sat on a tuffet eating curds and whey", answer: "Little Miss Muffet" }
      ]
    },
    {
      title: "Famous Babies",
      clues: [
        { value: 100, clue: "This baby elephant with huge ears learns to fly", answer: "Dumbo" },
        { value: 200, clue: "Peppa Pig's little brother", answer: "George" },
        { value: 300, clue: "Tommy Pickles leads the babies in this cartoon", answer: "Rugrats" },
        { value: 400, clue: "The real name of \"Baby Yoda\" in The Mandalorian", answer: "Grogu" },
        { value: 500, clue: "The 1987 film with Tom Selleck, Steve Guttenberg and Ted Danson", answer: "Three Men and a Baby" }
      ]
    },
    {
      title: "Baby Animals",
      clues: [
        { value: 100, clue: "A baby sheep", answer: "Lamb" },
        { value: 200, clue: "A baby kangaroo", answer: "Joey" },
        { value: 300, clue: "A baby goat", answer: "Kid" },
        { value: 400, clue: "A baby horse", answer: "Foal" },
        { value: 500, clue: "A baby owl", answer: "Owlet" }
      ]
    },
    {
      title: "Mummy and Daddy to Be",
      clues: [
        { value: 100, clue: "Desola and Dapo first met in this place (city)", answer: "Bristol" },
        { value: 200, clue: "What football team does Dapo support?", answer: "Manchester United" },
        { value: 300, clue: "The first thing Desola craved during pregnancy", answer: "Greek Yoghurt" },
        { value: 400, clue: "Desola and Dapo's first international holiday destination", answer: "Cyprus" },
        { value: 500, clue: "The baby's due date", answer: "25th January" }
      ]
    },
    {
      title: "Baby Word Scramble",
      clues: [
        { value: 100, clue: "YMDUM", answer: "DUMMY" },
        { value: 200, clue: "ETRLAT", answer: "RATTLE" },
        { value: 300, clue: "KTNABEL", answer: "BLANKET" },
        { value: 400, clue: "RYSRUEN", answer: "NURSERY" },
        { value: 500, clue: "LERTSROL", answer: "STROLLER" }
      ]
    }
  ]
};
