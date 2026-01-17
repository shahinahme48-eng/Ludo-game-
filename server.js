const board = document.getElementById("board");

function createBoard(){
  board.innerHTML = "";
  for(let i=0;i<225;i++){
    let r=Math.floor(i/15);
    let c=i%15;
    let d=document.createElement("div");
    d.className="cell";

    if(r<6&&c<6)d.classList.add("green");
    else if(r<6&&c>8)d.classList.add("yellow");
    else if(r>8&&c<6)d.classList.add("red");
    else if(r>8&&c>8)d.classList.add("blue");

    if(r==7&&c>0&&c<7)d.classList.add("red");
    if(r==7&&c>7&&c<14)d.classList.add("yellow");
    if(c==7&&r>0&&r<7)d.classList.add("green");
    if(c==7&&r>7&&r<14)d.classList.add("blue");

    [[6,2],[2,8],[8,12],[12,6]].forEach(s=>{
      if(r==s[0]&&c==s[1])d.classList.add("safe");
    });

    d.id=`c-${r}-${c}`;
    board.appendChild(d);
  }

  addPiece(1,1,"green"); addPiece(1,4,"green");
  addPiece(4,1,"green"); addPiece(4,4,"green");

  addPiece(1,10,"yellow"); addPiece(1,13,"yellow");
  addPiece(4,10,"yellow"); addPiece(4,13,"yellow");

  addPiece(10,1,"red"); addPiece(10,4,"red");
  addPiece(13,1,"red"); addPiece(13,4,"red");

  addPiece(10,10,"blue"); addPiece(10,13,"blue");
  addPiece(13,10,"blue"); addPiece(13,13,"blue");
}

function addPiece(r,c,color){
  const p=document.createElement("div");
  p.className=`piece p-${color}`;
  document.getElementById(`c-${r}-${c}`).appendChild(p);
}

createBoard();
