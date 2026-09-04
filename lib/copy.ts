const english:Record<string,string[]>={
 'Where to next?':['Plan your journey','Where are you going?','Find your next connection','Next stop, your choice.','Where to next?'],
 'One journey. Every connection.':['Compare scheduled transit and walking connections.','A clear plan for every connection.','One plan for your whole journey.','Get the whole route in one place.','One journey. Every connection.'],
 'Connecting the dots':['Searching schedules','Checking your connections','Finding your route','Putting your journey together','Connecting the dots'],
 'Trip saved on this device.':['Trip saved on this device.','Your trip is saved on this device.','Trip saved here for next time.','This device remembers your trip.','Trip saved on this device. One less thing to remember.'],
 'No journey found for this search':['No journey found for this search','No matching journey was found','No connection matched this search','This search found no journey','No journey found. Let’s try another connection.'],
 'A little transfer time helps.':['Allow time for transfers.','Leave a transfer buffer.','Give your transfer a little room.','A little transfer time helps.','Give your transfer some breathing room.'],
};
const cantonese:Record<string,string[]>={
 '下一站，去邊？':['規劃交通行程','你想去邊度？','搵到下一個接駁','下一站，由你話事。','下一站，去邊？'],
 '一個行程，接通每一程。':['比較按時間表提供嘅交通及步行接駁。','清晰掌握每個接駁。','一個計劃，照顧全程。','唔使逐程搵，路線一次過睇。','一個行程，接通每一程。'],
 '搜尋接駁中':['正在搜尋時間表','正在核對接駁','幫你搵緊路線','將每一程接埋一齊','搜尋接駁中'],
 '行程已儲存喺呢部裝置。':['行程已儲存於此裝置。','已喺呢部裝置儲存行程。','行程儲存好，下次方便啲。','呢部裝置記低咗你嘅行程。','行程已儲存喺呢部裝置。個腦可以少記一樣。'],
 '轉車，預鬆少少。':['請預留轉車時間。','轉車請預留緩衝。','轉車時間，預多一啲。','轉車，預鬆少少。','轉車可以，衝刺就唔使喇。'],
};
export function copyAt(text:string,language:'en'|'zh',level:number):string{return (language==='en'?english:cantonese)[text]?.[Math.max(0,Math.min(4,Math.floor(level)-1))]||text;}
