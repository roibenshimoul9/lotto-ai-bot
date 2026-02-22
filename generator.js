function צורטופסמאוזן(סטטיסטיקה) {

  const כלהמספרים = Array.from({length:37},(_,i)=>i+1);

  // נשתמש בחמים + קרים + מאחרים
  const חמים = סטטיסטיקה.חמים.map(x=>x.מספר);
  const קרים = סטטיסטיקה.קרים.map(x=>x.מספר);
  const מאחרים = סטטיסטיקה.מאחרים.map(x=>x.מספר);

  function ערבב(arr){
    return arr.sort(()=>Math.random()-0.5);
  }

  function איזוןמספרים(מקור){

    const תוצאה = [];

    const נמוכים = מקור.filter(n=>n<=18);
    const גבוהים = מקור.filter(n=>n>18);

    ערבב(נמוכים);
    ערבב(גבוהים);

    while(תוצאה.length<6){
      if(תוצאה.filter(n=>n<=18).length<3 && נמוכים.length){
        תוצאה.push(נמוכים.pop());
      }
      if(תוצאה.filter(n=>n>18).length<3 && גבוהים.length){
        תוצאה.push(גבוהים.pop());
      }
    }

    return ערבב(תוצאה);
  }

  const שורות = [];

  for(let i=0;i<5;i++){

    let מאגר = [
      ...ערבב(חמים).slice(0,3),
      ...ערבב(קרים).slice(0,2),
      ...ערבב(מאחרים).slice(0,2)
    ];

    מאגר = [...new Set(מאגר)];

    while(מאגר.length<15){
      מאגר.push(כלהמספרים[Math.floor(Math.random()*37)]);
      מאגר = [...new Set(מאגר)];
    }

    const שורה = איזוןמספרים(מאגר.slice(0,10));

    const חזק = Math.floor(Math.random()*7)+1;

    שורות.push({
      מספרים: שורה.sort((a,b)=>a-b),
      חזק
    });
  }

  return שורות;
}
