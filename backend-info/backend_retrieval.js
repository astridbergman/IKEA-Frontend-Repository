async function getData() {
  const url = "http://localhost:8000/baseInfo";
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    const result = await response.json();
    console.log(result);
    return result;
  } catch (error) {
    console.error(error.message);
    throw error;
  }

}

async function displayRegions(document) {
  const data = await getData();

  for (let i = 0; i < data.length; i++) {
    const region = data[i];

    const regionElement = document.createElement('div');
    regionElement.classList.add('region');

    const nameElement = document.createElement('h2');
    nameElement.textContent = region.region;

    const scoreElement = document.createElement('p');
    scoreElement.textContent = `Score: ${region.score}`;

    regionElement.appendChild(nameElement);
    regionElement.appendChild(scoreElement);

    document.body.appendChild(regionElement);
  }
}