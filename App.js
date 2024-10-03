const { error } = require('console');
const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const app = express();
const port = 3000;
const readline = require('readline');
const XLSX = require('xlsx');
const path = require('path');

// Middleware para recibir JSON
app.use(express.json());

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Ruta que recibe el JSON para configurar el scraping
app.post('/scrape', async (req, res) => {
    const { ExcelName, paginacion, navbutton, activebutton, iniUrl, url1, url2, url3, url4, selectors } = req.body;

    try {
        // Llama a la función scrape con los nuevos valores
        const data = await scrape(ExcelName, paginacion, navbutton, activebutton, iniUrl, url1, url2, url3, url4, selectors);

        res.json({ success: true, data });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });

    }
});


// url de api
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// funcion de scrap
async function scrape(ExcelName, paginacion, navbutton, activebutton, iniUrl, url1, url2, url3, url4, selectors) {
    // ----------------------------- En caso de boton de Paginacion = true -----------------------------
    if (paginacion) {
        const startTime = Date.now();

        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page1 = await context.newPage();
        const page2 = await context.newPage();
        const page3 = await context.newPage();
        const page4 = await context.newPage();

        await page1.goto(iniUrl);

        //solicita enviar r en consola para continuar
        await new Promise((resolve) => {
            rl.question('Presiona la tecla "r" para continuar... ', (input) => {
                if (input.toLowerCase() === 'r') {
                    console.log('Tecla "r" detectada, continuando...');
                    rl.close();
                    resolve();
                }
            });
        });

        const allProducts = [];
        const seenCodes = new Set();

        // Proceso async que recolecta productos, guarda en array y cambia de página para cada url 
        const processUrls = async (page, urls, tabNumber) => {
            for (const url of urls) {
                console.log(`Pestaña ${tabNumber}: Entrando a ${url}...`);

                await page.goto(url);

                console.log(`Pestaña ${tabNumber}: Esperando 4 segundos...`);
                await page.waitForTimeout(4000);

                let hasNextPage = true;
                let pageNum = 1;

                while (hasNextPage) {

                    console.log(`Pestaña ${tabNumber}: Extrayendo datos de la página ${pageNum}...`);

                    // Extraer productos de la página actual
                    const products = await page.$$eval(selectors.Productos, (items, selectors) => {
                        return items.map(item => {
                            // Identifica el link
                            const linkElement = item.querySelector(selectors.Link);
                            // Toma el link del producto o deja en blanco
                            const href = linkElement ? linkElement.href : '';
                            // Toma la expresión regular de json y elimina el primer y último carácter, es así por los caracteres especiales
                            const expRegular = new RegExp(selectors.expRegular.slice(1, -1));
                            // Utiliza la exprecion regular para identificar el codigo y despues tomarlo o dejar nulo
                            const codigoMatch = href.match(expRegular);
                            const codigo = codigoMatch ? codigoMatch[1] : null;
                            // Tomas de elementos
                            const imgElement = item.querySelector(selectors.Img);
                            const labElement = item.querySelector(selectors.Lab);
                            const nombreElement = item.querySelector(selectors.Nombre);
                            const precioElement = item.querySelector(selectors.Precio);
                            const ofertaElement = item.querySelector(selectors.Oferta);
                            // toma el precio y solo deja los numeros
                            const precio = precioElement ? precioElement.textContent.match(/\d+/g).join('') : null;
                            const oferta = ofertaElement ? ofertaElement.textContent.match(/\d+/g).join('') : null;
                            let finalPrecio;
                            let finalOferta;

                            // Orden de Precio y oferta, tener en cuenta si Precio de oferta toma el lugar de precio normal
                            if (selectors.Order) {
                                finalPrecio = precio ? precio : oferta;
                                finalOferta = precio ? oferta : null;
                            } else {
                                finalPrecio = oferta ? oferta : precio;
                                finalOferta = oferta ? precio : null;
                            }

                            return {
                                Lab: labElement ? labElement.innerText : null,
                                Nombre: nombreElement ? nombreElement.innerText : null,
                                Precio: finalPrecio,
                                Oferta: finalOferta,
                                Codigo: codigo,
                                Link: href,
                                Img: imgElement ? imgElement.src : null
                            };
                        });
                    }, selectors);

                    // Compara los links de los productos que se van guardando, si se repita omite el producto y sigue.
                    products.forEach(product => {
                        if (product.Link && !seenCodes.has(product.Link)) {
                            allProducts.push(product);
                            seenCodes.add(product.Link);
                        }
                    });

                    await page.waitForTimeout(3000)

                    // Sistema de Paginacion, intenta cambiar de pagina
                    try {
                        console.log(`Pestaña ${tabNumber}: Buscando el botón de la siguiente página...`);

                        // Encuentra el botón de la siguiente página
                        const nextPageButton = await page.evaluateHandle(({ navbutton, activebutton }) => {
                            const buttons = Array.from(document.querySelectorAll(navbutton));
                            const currentButton = buttons.find(button => button.classList.contains(activebutton));
                            const nextButton = buttons[buttons.indexOf(currentButton) + 1];
                            return nextButton;
                        }, { navbutton, activebutton });
                        // Intenta hacer click en la siguiente pagina
                        if (nextPageButton) {
                            console.log(`Pestaña ${tabNumber}: Haciendo clic en el botón de la siguiente página...`);
                            await nextPageButton.click();
                            pageNum++;
                            console.log(`Pestaña ${tabNumber}: Esperando la carga de la página ${pageNum}...`);
                            console.log('3 seg..')
                            await page.waitForTimeout(3000);
                        } else {
                            console.log(`Pestaña ${tabNumber}: No hay más páginas disponibles.`);
                            hasNextPage = false;
                        }
                    } catch (error) {
                        console.log(`Pestaña ${tabNumber}: Error al intentar encontrar o hacer clic en el botón de la siguiente página:`, /*error*/);
                        hasNextPage = false;
                    }
                }
            }
        };

        // Cantidad de ventanas, si se quiere agregar, tambien arreglar lineas 43 - 46+ y en json
        await Promise.all([
            processUrls(page1, url1, 1),
            processUrls(page2, url2, 2),
            processUrls(page3, url3, 3),
            processUrls(page4, url4, 4)
        ]);

        console.log(`Total de productos extraídos: ${allProducts.length}`);

        console.log('Creando excel...');

        if (!fs.existsSync(path.join(__dirname, 'Excels'))) {
            fs.mkdirSync(path.join(__dirname, 'Excels'));
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(allProducts);
        XLSX.utils.book_append_sheet(wb, ws, 'Productos');
        const excelPath = path.join(__dirname, 'Excels', `${ExcelName}.xlsx`);
        XLSX.writeFile(wb, excelPath);

        console.log(`Archivo Excel guardado en: ${excelPath}`);

        await browser.close();

        // Muestra el tiempo que se demoro el proceso completo
        const endTime = Date.now();
        const duracionMs = endTime - startTime;
        const duracionSec = Math.floor(duracionMs / 1000);
        const duracionMin = Math.floor(duracionSec / 60);
        const hrs = Math.floor(duracionMin / 60);
        const min = duracionMin % 60;
        const sec = duracionSec % 60;

        console.log(`Tiempo total: ${hrs}:${min}:${sec}`);

        return { allProducts, excelPath };

        /// --------------------- En Caso de NO paginacion y cargas de mas productos ------------------------------
    } else {

        const startTime = Date.now();
        const browser = await chromium.launch({ headless: false });

        const context = await browser.newContext();
        const page1 = await context.newPage();
        const page2 = await context.newPage();
        const page3 = await context.newPage();
        const page4 = await context.newPage();

        await page1.goto(iniUrl);

        await new Promise((resolve) => {
            rl.question('Presiona la tecla "r" para continuar... ', (input) => {
                if (input.toLowerCase() === 'r') {
                    console.log('Tecla "r" detectada, continuando...');
                    rl.close();
                    resolve();
                }
            });
        });

        const allProducts = [];
        const seenCodes = new Set();

        const processUrls = async (page, urls, tabNumber) => {
            for (const url of urls) {
                console.log(`Pestaña ${tabNumber}: Entrando a ${url}...`);

                await page.goto(url);
                console.log(`Pestaña ${tabNumber}: Esperando 4 segundos...`);
                await page.waitForTimeout(4000);

                // Mientra se encuentre el boton se cargaran mas productos antes de recolectar
                let loadMore = true;
                while (loadMore) {
                    try {
                        console.log(`Pestaña ${tabNumber}: Buscando el botón de mostrar más...`);

                        // Determina Selector de boton
                        const loadMoreButton = await page.$(activebutton);
                        // busca e intenta hacerc click en el boton
                        if (loadMoreButton) {
                            console.log(`Pestaña ${tabNumber}: Haciendo clic en el botón Más Resultados...`);
                            await loadMoreButton.click();
                            console.log(`Pestaña ${tabNumber}: Esperando la carga de más productos...`);
                            await page.waitForSelector(selectors.Productos)
                            await page.waitForTimeout(5000);
                        } else {
                            console.log(`Pestaña ${tabNumber}: No se puede cargar más productos.`);
                            loadMore = false;
                        }
                    } catch (error) {
                        console.log(`Pestaña ${tabNumber}: No se puede cargar más productos. - Catch Error -`);
                        loadMore = false;
                    }
                }

                console.log(`Pestaña ${tabNumber}: Esperando 5 segundos para asegurarse de que el contenido dinámico se cargue...`);
                await page.waitForTimeout(5000);
                console.log(`Pestaña ${tabNumber}: Extrayendo datos de la página ${url}...`);

                // Extraer productos de la página actual
                const products = await page.$$eval(selectors.Productos, (items, selectors) => {
                    return items.map(item => {
                        const linkElement = item.querySelector(selectors.Link);
                        const href = linkElement ? linkElement.href : null;
                        const expRegular = new RegExp(selectors.expRegular.slice(1, -1));
                        const codigoMatch = href.match(expRegular);
                        const codigo = codigoMatch ? codigoMatch[1] : null;
                        const imgElement = item.querySelector(selectors.Img);
                        const labElement = item.querySelector(selectors.Lab);
                        const nombreElement = item.querySelector(selectors.Nombre);
                        const precioElement = item.querySelector(selectors.Precio);
                        const ofertaElement = item.querySelector(selectors.Oferta);

                        const precio = precioElement ? precioElement.textContent.match(/\d+/g).join('') : null;
                        const oferta = ofertaElement ? ofertaElement.textContent.match(/\d+/g).join('') : null;

                        let finalPrecio;
                        let finalOferta;


                        if (selectors.Order) {
                            finalPrecio = precio ? precio : oferta;
                            finalOferta = precio ? oferta : null;
                        } else {
                            finalPrecio = oferta ? oferta : precio;
                            finalOferta = oferta ? precio : null;
                        }
                        return {
                            Lab: labElement ? labElement.innerText : null,
                            Nombre: nombreElement ? nombreElement.innerText : null,
                            Precio: finalPrecio,
                            Oferta: finalOferta,
                            Codigo: codigo,
                            Link: href,
                            Img: imgElement ? imgElement.src : null
                        };
                    });
                }, selectors);

                products.forEach(product => {
                    if (product.Link && !seenCodes.has(product.Link)) {
                        allProducts.push(product);
                        seenCodes.add(product.Link);
                    }
                });
            }
        };

        await Promise.all([
            processUrls(page1, url1, 1),
            processUrls(page2, url2, 2),
            processUrls(page3, url3, 3),
            processUrls(page4, url4, 4)
        ]);

        console.log(`Total de productos extraídos: ${allProducts.length}`);

        // --------------------------- Pasar Array a Excel ---------------------------

        if (!fs.existsSync(path.join(__dirname, 'Excels'))) {
            fs.mkdirSync(path.join(__dirname, 'Excels'));
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(allProducts);
        XLSX.utils.book_append_sheet(wb, ws, 'Productos');
        const excelPath = path.join(__dirname, 'Excels', `${ExcelName}.xlsx`);
        XLSX.writeFile(wb, excelPath);

        console.log(`Archivo Excel guardado en: ${excelPath}`);

        await browser.close();

        const endTime = Date.now();
        const duracionMs = endTime - startTime;
        const duracionSec = Math.floor(duracionMs / 1000);
        const duracionMin = Math.floor(duracionSec / 60);
        const hrs = Math.floor(duracionMin / 60);
        const min = duracionMin % 60;
        const sec = duracionSec % 60;

        console.log(`Tiempo total: ${hrs}:${min}:${sec}`);


        return { allProducts, excelPath };

    }
}