const mapCanvas = document.getElementById("canvas");
const ctx = mapCanvas.getContext("2d", { willReadFrequently: true });
const map = [];
const unitSize = 1;
const mapDimension = 256;

mapCanvas.height=canvas.width = mapDimension;

// make a mayan temple
for(let x = 0; x < mapDimension; x++){
    map[x] = [];
    for(let y = 0; y < mapDimension; y++){
        let startingBound = mapDimension / 4;
        let endingBound = (mapDimension / 4) * 3;

        if (y > startingBound && y < endingBound && x > startingBound && x < endingBound){
            const base = endingBound - startingBound;
            const sections = 10;
            const sectionSize = base/sections;
            const baseHeight = 0.2;
            const colIncr = (1-baseHeight)/sections;

            for(let i = 0; i <sections; i++){
                if(y > startingBound && y < endingBound && x > startingBound && x < endingBound){
                    map[x][y] = (i * colIncr) + baseHeight;
                }
                startingBound += sectionSize / 2;
                endingBound -= sectionSize / 2;
            }
        }else{
            map[x][y] = Math.random() * 0.1;
        }
    }
}

colorMap();
drawShadowMap(512, 256, 2);
drawShadowMap(512,-256, 3);
drawRenderedMap(mapDimension, 300, 4, 200, mapDimension / 2, mapDimension + 50);

// size, viewAngle, yaw, camHeight, camX, camY
function colorMap(){
for(let x = 0; x < mapDimension; x++){
    for(let y = 0; y < mapDimension; y++){
        const color = parseInt(map[x][y] * 100) + 100;

        if(color==0 || color< 0){
            color = 110;
        }

        ctx.fillStyle = `rgb(${color},${color},${Math.floor(color*.8)})`;
        ctx.fillRect (x, y, 1, 1);
    }
}
}
//Create Shadowmap
function drawShadowMap(sunPosX, sunPosY, sunHeight){
    const ctx = mapCanvas.getContext("2d");
    let x = 0;
    let y = 0;
    let sunX = 0;
    let sunY = 0;
    let sunZ = 0;
    let pX = 0;
    let pY = 0;
    let pZ = 0;
    let mag = 0;
    let dX = 0;
    let dY = 0;
    let dZ = 0;

    // Suns position
    sunX = sunPosX;
    sunY = sunPosY;
    sunZ = sunHeight;

    for(x = 0; x <= mapDimension-1; x += unitSize){
        for(y = 0; y <=  mapDimension-1; y += unitSize){
            dX = sunX - x;
            dY = sunY - y;
            dZ = sunZ - map[x][y];

            mag = Math.sqrt(dX * dX + dY * dY + dZ * dZ);

            dX = (dX / mag);
            dY = (dY / mag);
            dZ = (dZ / mag);

            pX = x;
            pY = y;
            pZ = map[x][y];

            while (pX >= 0 && pX < mapDimension && pY >= 0 && pY < mapDimension && pZ <= sunZ){

                const rPx = round(pX);
                const rPy = round(pY);

                if (rPx < mapDimension && rPx > 0 && rPy < mapDimension && rPy > 0){
                    if((map[round(pX)][round(pY)]) > pZ){
                        ctx.fillStyle = "rgba(" + 0 + "," +  0 + "," + 0 +"," + 0.6 + ")";
                        ctx.fillRect (x, y, unitSize, unitSize);
                        break;
                    }
                }

                pX += (dX * unitSize);
                pY += (dY * unitSize);
                pZ += (dZ * unitSize);

            }
        }
    }
}

//Create Voxel View
function drawRenderedMap(size, viewAngle, yaw, camHeight, camX, camY){
    const voxCanvas = document.getElementById("voxCanvas");
    const ctx = voxCanvas.getContext("2d");
    const sCtx = mapCanvas.getContext("2d");
    const sCanvasData = sCtx.getImageData(0, 0, mapDimension, mapDimension);
    let idx = 0;

    ctx.clearRect(0,0,mapDimension,mapDimension);
    voxCanvas.width = voxCanvas.height = mapDimension;

    document.onkeydown = function(evt){
        if (evt.key === 'ArrowRight'){
            drawRenderedMap(size, viewAngle += .10, yaw, camHeight, camX, camY);
        }else if (evt.key === 'ArrowLeft'){
            drawRenderedMap(size, viewAngle -= .10, yaw, camHeight, camX, camY);
        }else if (evt.key === 'ArrowUp'){
            drawRenderedMap(size, viewAngle, yaw, camHeight, camX, camY -= 5);
        }else if (evt.key === 'ArrowDown'){
            drawRenderedMap(size, viewAngle, yaw, camHeight, camX, camY += 5);
        }else if (evt.key === 'PageDown'){
            drawRenderedMap(size, viewAngle, yaw, camHeight -= 5, camX, camY);
        }else if (evt.key === 'PageUp'){
            drawRenderedMap(size, viewAngle, yaw, camHeight += 5, camX, camY);
        }
    };

    let Ray = 0;
    let ix = 0;
    let iy = 0;
    //Field of view
    const fov = 1;
    const iRay = fov / mapDimension;

    let Highest = 0;
    let VxHigh = 0;
    let ScreenAt = 0;
    // Camera height
    let MidOut = yaw;
    // Angle of view
    let vy = viewAngle;

    // Gets the distance multiplier for the camera
    ScreenAt = parseInt((mapDimension / 2) * Math.tan(fov / 2));

    for (let AngRay = (vy - (fov / 2)); Ray < mapDimension; Ray += unitSize, AngRay += iRay) {

        // Camera position
        let px = camX;
        let py = camY;

        // how much to increment based on the angle for the ray
        ix = Math.cos (AngRay);
        iy = Math.sin (AngRay);

        idy = Math.cos (AngRay - (vy));
        let dy = idy;

        // Set the current position at the bottom of the image
        Highest = mapDimension;

        while (px >= 0 && px < mapDimension-1 && py >= 0 && py < (mapDimension+mapDimension * 2)) {

            VxHigh = (((map[round(px)][round(py)]* camHeight)  * (ScreenAt  / dy)) + MidOut) / map[round(px)][round(py)] ;

            /* If it's above the highest point drawn so far. */
            if (VxHigh < Highest) {

                idx = (round(px) + round(py) * mapDimension) * 4;
                ctx.fillStyle = "rgb(" + sCanvasData.data[idx + 0] + "," +  sCanvasData.data[idx + 1] + "," + sCanvasData.data[idx + 2] +")";
                ctx.fillRect(Ray, VxHigh, unitSize,  Highest - VxHigh);

                // Uncomment this line to see the overhead perspective of what your looking at

                // ctx.fillRect (round(px), round(py), unitSize, unitSize);

                if (VxHigh < 0){
                    break;
                }

                Highest = VxHigh + 1;
            }

            px += ix;
            py += iy;
            dy += idy;
        }
    }

}

// Round to nearest pixel
function round(n) {
    if (n-(parseInt(n)) >= 0.5){
        return parseInt(n)+1;
    }
    return parseInt(n);
}